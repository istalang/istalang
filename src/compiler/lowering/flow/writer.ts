/**
 * Writing a flow (checker surface/flow-ir.ts) as an entry's code: lowering reads the order a body
 * runs in and what it releases where from its flow, and maps each operation and exit to the
 * instructions it is (operations.ts, exits.ts), in the blocks' order (layout.ts).
 *
 * - **One register per value.** A variable's is its declaring name's at its type (variables.ts),
 *   shared by every flow the entry writes; a field loop's passes bind one name to several types,
 *   so each pass has its own. A read of a variable at a name is the variable's register, which
 *   nothing releases. Any other value gets the register its operation gave: owning what it made, or
 *   borrowing the part it read.
 * - **Ownership** (docs/arch/definition.md, "Holders"). A value used once is moved where an
 *   instruction takes it (`CodeWriter.take`); a variable, or a value used twice, is copied. Writing
 *   a variable lets go of what it held first. A value's release lets go of its register and of
 *   what its operation allocated beside it (`extras`), which nothing else took.
 * - **A flow returns** from the entry; a default's or an initializer's written inline gives its
 *   value instead (`FlowEnd`), where its root returns it, then goes on past it.
 * - **Each block is written inside the passes of the field loops it is in** (§4), so its calls
 *   close and its nested functions are keyed there.
 */

import type { Place } from '../../../definition/instructions/places.ts';
import type { Register } from '../../../definition/operands.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type {
  BlockId,
  FlowBlock,
  FlowFunction,
  FlowValue,
  Operation,
  ValueId,
} from '../../checker/surface/flow-ir.ts';
import type { Type } from '../../checker/types/type/index.ts';
import type { LabelledScope } from '../../syntax/statements/index.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { FunctionContext } from '../context.ts';
import type { Label } from '../functions/code-writer.ts';
import type { TypedValue } from '../values/holdings.ts';
import { exitWriters } from './exits.ts';
import { FlowWaits } from './flow-waits.ts';
import { type FlowLayout, layoutOf } from './layout.ts';
import { operationWriters } from './operations.ts';
import { type FlowUses, usesOf } from './uses.ts';
import {
  concreteType,
  declaringWrites,
  knownVariableRegister,
  variableRegister,
  variableType,
} from './variables.ts';

/** How a flow's root gives its value: by returning from the entry, or into a register. */
export type FlowEnd =
  | { readonly kind: 'return' }
  | { readonly kind: 'into'; readonly into: Register };

/** Writes `flow`, its parameters in `parameters`, its root's value given as `end` says. */
export function writeFlow(
  context: FunctionContext,
  flow: FlowFunction,
  { parameters, end }: { readonly parameters: readonly Register[]; readonly end: FlowEnd },
): void {
  const writer = new FlowWriter(context, flow, end);
  for (const [index, register] of parameters.entries()) {
    writer.bind(flow.parameters[index] ?? unreachable(`No parameter ${index}.`), register);
  }
  writer.write();
}

export class FlowWriter {
  readonly context: FunctionContext;
  readonly flow: FlowFunction;
  readonly end: FlowEnd;
  readonly #layout: FlowLayout;
  readonly #registers = new Map<ValueId, Register>();
  /** The values whose register is another's, a variable's read at a name: nothing releases them. */
  readonly #aliases = new Set<ValueId>();
  readonly #extras = new Map<ValueId, readonly Register[]>();
  readonly #labels = new Map<BlockId, Label>();
  /** How many registers the entry had where each block written so far began. */
  readonly #started = new Map<BlockId, number>();
  /** Where what each held variable holds is kept until (§7). */
  readonly #uses: FlowUses;
  readonly waits = new FlowWaits();
  /** The arrays what `hold`s keep is kept in, by scope and type. */
  readonly #lists = new Map<LabelledScope | 'function', Map<string, Register>>();
  /** The writes of a variable living in a cell that make its cell (variables.ts). */
  readonly declaring: ReadonlySet<Operation>;
  /** A value converted into the field a key of several names names, by the value it converts. */
  readonly keyed = new Map<ValueId, ValueId>();
  #block: BlockId = 0;
  #next: BlockId | undefined;
  readonly #after: Label;

  constructor(context: FunctionContext, flow: FlowFunction, end: FlowEnd) {
    this.context = context;
    this.flow = flow;
    this.end = end;
    this.#after = context.code.newLabel();
    this.#layout = layoutOf(flow);
    this.declaring = declaringWrites(flow);
    this.#uses = usesOf(flow);
  }

  write(): void {
    const { order } = this.#layout;
    for (const [value, until] of this.#uses.kept) {
      this.listOf(until, this.typeOf(value));
    }
    for (const [position, block] of order.entries()) {
      this.#block = block;
      this.#next = order[position + 1];
      this.context.code.place(this.labelOf(block));
      this.#started.set(block, this.context.code.registerCount);
      this.context.inFieldPasses(this.#layout.passesOf(block), () =>
        this.#writeBlock(this.flow.blocks[block] as FlowBlock),
      );
    }
    this.context.code.place(this.#after);
    const last = this.flow.blocks[order.at(-1) ?? 0]?.exit;
    if (this.end.kind === 'return' && last?.kind === 'stop') {
      this.context.code.emit({ kind: 'unreachable', span: this.flow.root.span });
    }
  }

  #writeBlock({ operations, exit }: FlowBlock): void {
    for (const operation of operations) {
      const { code } = this.context;
      const { registers } = code.allocating(() => writerOf(operation)(this, operation));
      const own = 'into' in operation ? operation.into : undefined;
      const value = own === undefined ? undefined : this.#knownRegister(own);
      const extras = registers.filter(
        (register) => register !== value && !code.isBorrowed(register) && !this.#isValues(register),
      );
      if (own === undefined) {
        code.letGo(extras, operation.site.span);
      } else if (extras.length > 0) {
        this.#extras.set(own, [...(this.#extras.get(own) ?? []), ...extras]);
      }
    }
    exitWriters[exit.kind](this, exit as never);
  }

  /** Whether some value lives in `register`, a variable's or what a future gave included. */
  #isValues(register: Register): boolean {
    return (
      this.context.variables.isVariable(register) ||
      [...this.#registers.values()].includes(register) ||
      this.waits.holdsGiven(register)
    );
  }

  // Values.

  valueOf(value: ValueId): FlowValue {
    return this.flow.values[value] ?? unreachable(`No value ${value} in the flow.`);
  }

  /**
   * `value`'s type as the pass being written reads it: a variable's as its body declares it there,
   * as one name holds each pass's field in a field loop (§4).
   */
  typeOf(value: ValueId): Type {
    const flowValue = this.valueOf(value);
    const type =
      flowValue.kind === 'variable'
        ? variableType(this.context, flowValue.entity.name, flowValue.type)
        : flowValue.type && concreteType(this.context, flowValue.type);
    return type ?? unreachable(`Value ${value} was never checked.`);
  }

  /** `value`'s register, and its type. */
  typed(value: ValueId): TypedValue {
    return { register: this.registerOf(value), type: this.typeOf(value) };
  }

  /**
   * `value`'s register: a parameter's, its variable's at the type the pass being written reads it
   * as, or the one its operation gave.
   */
  registerOf(value: ValueId): Register {
    const known = this.#registers.get(value);
    if (known !== undefined) {
      return known;
    }
    const flowValue = this.valueOf(value);
    if (flowValue.kind !== 'variable') {
      return unreachable(`Value ${value} is read before anything gave it.`);
    }
    const register = variableRegister(this.context, flowValue, this.typeOf(value));
    this.context.code.pin(register);
    return register;
  }

  /** `value`'s register where it has one already, as `registerOf` finds it. */
  #knownRegister(value: ValueId): Register | undefined {
    const flowValue = this.valueOf(value);
    return (
      this.#registers.get(value) ??
      (flowValue.kind === 'variable'
        ? knownVariableRegister(this.context, flowValue, this.typeOf(value))
        : undefined)
    );
  }

  /** Makes `register` `value`'s; a variable's, or a value read twice, is copied where taken. */
  bind(value: ValueId, register: Register): void {
    this.#registers.set(value, register);
    if (this.valueOf(value).kind === 'variable' || (this.#uses.reads.get(value) ?? 0) > 1) {
      this.context.code.pin(register);
    }
  }

  /** Makes `value` the variable's read `register` is, which nothing releases. */
  alias(value: ValueId, register: Register): void {
    this.#registers.set(value, register);
    this.#aliases.add(value);
  }

  /**
   * `value` given `produced` by `operation`: a temporary's own register, or written into its
   * variable, which lets go of what it held first; into its cell, made anew where `operation`
   * declares it (variables.ts).
   */
  define(value: ValueId, produced: Register, span: AnchoredSpan, operation?: Operation): void {
    const flowValue = this.valueOf(value);
    const { code } = this.context;
    if (flowValue.kind !== 'variable') {
      this.#defineTemporary(value, produced, span);
      return;
    }
    const register = this.registerOf(value);
    if (register === produced) {
      return;
    }
    if (code.typeOf(register).kind === 'reference') {
      const place: Place = { root: { kind: 'reference', register }, path: [] };
      code.emit({ kind: 'store', span, place, value: code.take(produced, span) });
      return;
    }
    if (flowValue.inCell) {
      this.writeCell(
        register,
        produced,
        span,
        operation !== undefined && this.declaring.has(operation),
      );
      return;
    }
    code.letGo([register], span);
    code.emit({ kind: 'move', span, dst: register, src: code.take(produced, span) });
  }

  /**
   * A temporary given `produced`: its own register where nothing else is in it; else a register of
   * its own `produced` is moved or copied into, the one register of a value several paths give.
   */
  #defineTemporary(value: ValueId, produced: Register, span: AnchoredSpan): void {
    const { code } = this.context;
    const known = this.#registers.get(value);
    if (known === produced) {
      return;
    }
    const shared = (this.#uses.writes.get(value) ?? 0) > 1;
    if (known === undefined && !shared && !this.#isValues(produced)) {
      this.bind(value, produced);
      return;
    }
    const register = known ?? code.allocate(code.typeOf(produced));
    if (known === undefined) {
      this.bind(value, register);
    }
    // A path may give it twice, as `a and b` gives `a` first: the second ends the first.
    const taken = code.take(produced, span);
    code.letGo([register], span);
    code.emit({ kind: 'move', span, dst: register, src: taken });
  }

  /** Writes `produced` into the variable living in the cell `cell`: a new cell where it is made. */
  writeCell(cell: Register, produced: Register, span: AnchoredSpan, declares: boolean): void {
    const { code } = this.context;
    const value = code.take(produced, span);
    if (declares) {
      code.letGo([cell], span);
      code.emit({ kind: 'newCell', span, dst: cell, value });
    } else {
      code.emit({
        kind: 'store',
        span,
        place: { root: { kind: 'cell', register: cell }, path: [] },
        value,
      });
    }
  }

  /** The registers `values` end: each one's and its extras, a held one's lists where it ends. */
  registersEnding(values: readonly ValueId[]): readonly Register[] {
    const registers = values.flatMap((value) => {
      const until = this.#uses.kept.get(value);
      if (until !== undefined) {
        return until === 'function' ? [] : [...(this.#lists.get(until)?.values() ?? [])];
      }
      if (this.#aliases.has(value)) {
        return [];
      }
      const known = this.#knownRegister(value);
      return known === undefined ? [] : [known, ...(this.#extras.get(value) ?? [])];
    });
    return [...new Set(registers)];
  }

  /**
   * Lets go of `registers`, if there are any; a list of what `hold`s keep, let go of where its
   * scope ends, is made anew, empty, for the scope's next run.
   */
  release(registers: readonly Register[], span: AnchoredSpan): void {
    const { code } = this.context;
    code.letGo(registers, span);
    for (const list of registers.filter((register) => this.#isList(register))) {
      code.emit({ kind: 'array', span, dst: list, elements: [] });
    }
  }

  /** The array what `hold`s keep of `type` until `until` ends is kept in (§7). */
  listOf(until: LabelledScope | 'function', type: Type): Register {
    const lists = this.#lists.get(until) ?? new Map<string, Register>();
    this.#lists.set(until, lists);
    const key = this.context.checker.typeKeys.typeKey(type);
    const known = lists.get(key);
    if (known !== undefined) {
      return known;
    }
    const { checker, tables, code } = this.context;
    const arrayType = checker.wellKnownType({ module: 'prelude', name: 'Array' }, [type]);
    const list = code.allocate(
      tables.types.reference(arrayType ?? unreachable('The prelude has arrays.')),
    );
    code.pin(list);
    lists.set(key, list);
    code.emit({ kind: 'array', span: this.flow.root.span, dst: list, elements: [] });
    return list;
  }

  // Blocks.

  labelOf(block: BlockId): Label {
    return memo(this.#labels, block, () => this.context.code.newLabel());
  }

  /**
   * Goes on to `block`: the next pass where it is a field loop's top, unless written next. Going
   * back to a block written already closes a loop, whose next turn starts with none of this turn's
   * temporaries, so they are let go of first: overwriting a register ends nothing.
   */
  goTo(block: BlockId, span: AnchoredSpan): void {
    const target = this.#layout.towards(this.#block, block);
    const started = this.#started.get(target);
    if (started !== undefined) {
      const { code, variables } = this.context;
      const turns = Array.from({ length: code.registerCount - started }, (_, at) => started + at);
      code.letGo(
        turns.filter((register) => !(variables.isVariable(register) || this.#isList(register))),
        span,
      );
    }
    if (target !== this.#next) {
      this.context.code.jump(this.labelOf(target), span);
    }
  }

  /** Jumps to `block` from code written before the next block begins, as a landing is. */
  jumpTo(block: BlockId, span: AnchoredSpan): void {
    this.context.code.jump(this.labelOf(block), span);
  }

  /** Whether `register` keeps what `hold`s keep. */
  #isList(register: Register): boolean {
    return [...this.#lists.values()].some((lists) => [...lists.values()].includes(register));
  }

  /** Where the field loop whose top is being written goes first. */
  firstPass(): BlockId {
    return this.#layout.firstOf(this.#block);
  }

  /** Goes on past the flow, its root's value given into `end.into`. */
  leave(span: AnchoredSpan): void {
    if (this.#next !== undefined) {
      this.context.code.jump(this.#after, span);
    }
  }
}

function writerOf(operation: Operation): (writer: FlowWriter, operation: Operation) => void {
  return operationWriters[operation.op] as (writer: FlowWriter, operation: Operation) => void;
}
