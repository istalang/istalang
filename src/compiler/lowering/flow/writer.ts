/**
 * Writing a flow (checker surface/flow-ir.ts) as an entry's code: lowering reads the order a body
 * runs in and what it releases where from its flow, and maps each operation and exit to the
 * instructions it is (operations.ts, exits.ts), in the blocks' order (layout.ts).
 *
 * - **One register per value.** A variable's is its declaring name's (`VariableRegisters`), shared
 *   by every flow the entry writes (its defaults', then its body's), a cell where it lives in one. A
 *   read of a variable at a name is the variable's register. Any other value gets the register its
 *   first operation made, unless another value holds it already, which it is then moved out of.
 * - **What an operation allocates beside its value** (a fit's parts, a union's tag, a copy-in
 *   cell) is that value's, released with it; an operation giving no value releases them at once.
 * - **A flow returns** from the entry; a default's or an initializer's written inline gives its
 *   value instead (`FlowEnd`), where its root returns it, then goes on past it.
 * - **Each block is read as the passes of the field loops it is in read it** (§4), so its calls
 *   close and its nested functions are keyed there.
 */

import type { Register } from '../../../definition/operands.ts';
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
import { programModule } from '../../program/program.ts';
import type { LabelledScope, Statement } from '../../syntax/statements/index.ts';
import { ancestorsOf, type SyntaxNode } from '../../syntax/tree/index.ts';
import type { NodeOf } from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { FunctionContext } from '../context.ts';
import type { Label } from '../functions/code-writer.ts';
import type { TypedValue } from '../values/holdings.ts';
import { exitWriters } from './exits.ts';
import { type FlowLayout, layoutOf, type PassVisit } from './layout.ts';
import { operationWriters } from './operations.ts';
import { cellRegister } from './variables.ts';

/** How a flow's root gives its value: by returning from the entry, or into a register. */
export type FlowEnd =
  | { readonly kind: 'return' }
  | { readonly kind: 'into'; readonly into: Register };

/** A wait being opened: its register, and the futures handed to its cases so far. */
interface OpenWait {
  readonly wait: Register;
  readonly futures: ValueId[];
}

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
  /** The registers some value holds, which no other value's operation may take. */
  readonly #held = new Set<Register>();
  readonly #extras = new Map<ValueId, readonly Register[]>();
  readonly #labels = new Map<BlockId, Label>();
  /** Where what each held variable holds is kept until (§7). */
  readonly #kept = new Map<ValueId, LabelledScope | 'function'>();
  readonly #lists = new Map<LabelledScope | 'function', Register>();
  /** What a future gave once it settled: an `await`'s result, a `select` case's binding. */
  readonly #given = new Map<ValueId, Register>();
  /** A value converted into the field a key of several names names, by the value it converts. */
  readonly keyed = new Map<ValueId, ValueId>();
  /** The `Map`s being built, which an item appended to is a key and value pair. */
  readonly maps = new Set<ValueId>();
  #wait: OpenWait | undefined;
  #block: BlockId = 0;
  #next: BlockId | undefined;
  readonly #after: Label;

  constructor(context: FunctionContext, flow: FlowFunction, end: FlowEnd) {
    this.context = context;
    this.flow = flow;
    this.end = end;
    this.#after = context.code.newLabel();
    this.#layout = layoutOf(flow, (header, outer) =>
      context.inFieldPasses(outer, () => {
        const passes = context.body.passesOf(header);
        const subject = context.body.typeOf(header.subject);
        const names = (subject && context.checker.fieldsOf(subject)) ?? [];
        const fields = passes.map(({ visits }) =>
          visits.kind === 'field' ? visits.name : undefined,
        );
        const runs = names.flatMap(({ name }) => {
          const run = fields.indexOf(name);
          return run < 0 ? [] : [run];
        });
        return { fields, runs };
      }),
    );
    for (const { operations } of flow.blocks) {
      for (const operation of operations) {
        if (operation.op === 'keep') {
          for (const value of operation.values) {
            this.#kept.set(value, operation.until);
          }
        }
      }
    }
  }

  write(): void {
    const { order } = this.#layout;
    for (const [position, block] of order.entries()) {
      this.#block = block;
      this.#next = order[position + 1];
      this.context.code.place(this.labelOf(block));
      this.context.inFieldPasses(this.#layout.passesOf(block), () =>
        this.#writeBlock(this.flow.blocks[block] as FlowBlock),
      );
    }
    this.context.code.place(this.#after);
    const last = this.flow.blocks[order.at(-1) ?? 0]?.exit;
    if (this.end.kind === 'return' && last?.kind === 'stop') {
      // Code no path goes past still ends in a `return`, as loading requires.
      this.context.code.emit({
        kind: 'return',
        span: this.flow.root.span,
        value: this.context.code.allocate(),
      });
    }
  }

  #writeBlock({ operations, exit }: FlowBlock): void {
    for (const operation of operations) {
      const { registers } = this.context.code.allocating(() =>
        writerOf(operation)(this, operation),
      );
      const own = 'into' in operation ? operation.into : undefined;
      const extras = registers.filter((register) => !this.#held.has(register));
      if (own === undefined) {
        this.release(extras, operation.site.span);
      } else if (extras.length > 0) {
        this.#extras.set(own, [...(this.#extras.get(own) ?? []), ...extras]);
      }
    }
    exitWriters[exit.kind](this, exit as never);
  }

  // Values.

  valueOf(value: ValueId): FlowValue {
    return this.flow.values[value] ?? unreachable(`No value ${value} in the flow.`);
  }

  typeOf(value: ValueId): Type {
    return this.valueOf(value).type ?? unreachable(`Value ${value} was never checked.`);
  }

  /** `value`'s register, and its type. */
  typed(value: ValueId): TypedValue {
    return { register: this.registerOf(value), type: this.typeOf(value) };
  }

  /** `value`'s register: its variable's, or the one its operation gave, or a new one. */
  registerOf(value: ValueId): Register {
    const known = this.#registers.get(value);
    if (known !== undefined) {
      return known;
    }
    const register = this.#variableRegister(this.valueOf(value)) ?? this.context.code.allocate();
    this.bind(value, register);
    return register;
  }

  /** Makes `register` `value`'s. */
  bind(value: ValueId, register: Register): void {
    this.#registers.set(value, register);
    this.#held.add(register);
  }

  /** `value` given `produced`: its own register, or moved into the one it has. */
  define(value: ValueId, produced: Register, span: AnchoredSpan): void {
    const known = this.#registers.get(value) ?? this.#variableRegister(this.valueOf(value));
    if (known === undefined && !this.#held.has(produced)) {
      this.bind(value, produced);
      return;
    }
    const dst = known ?? this.registerOf(value);
    this.bind(value, dst);
    if (dst !== produced) {
      this.context.code.emit({ kind: 'move', span, dst, src: produced });
    }
  }

  /** The register a variable lives in, declared on its first write; undefined for a temporary. */
  #variableRegister(value: FlowValue): Register | undefined {
    if (value.kind !== 'variable') {
      return undefined;
    }
    const { variables } = this.context;
    const { name } = value.entity;
    if (!variables.has(name)) {
      const type = value.type ?? unreachable(`'${name.text}' was never checked.`);
      const register = value.inCell
        ? cellRegister(this.context, type)
        : this.context.code.allocate();
      variables.declare(name, register);
    }
    return variables.registerOf(name);
  }

  /** The registers `values` end: each one's and its extras, a held one's list where it ends. */
  registersEnding(values: readonly ValueId[]): readonly Register[] {
    const registers = values.flatMap((value) => {
      const until = this.#kept.get(value);
      if (until !== undefined) {
        return until === 'function' ? [] : [this.listOf(until)];
      }
      const known = this.#registers.get(value) ?? this.#variableRegister(this.valueOf(value));
      return known === undefined ? [] : [known, ...(this.#extras.get(value) ?? [])];
    });
    return [...new Set(registers)];
  }

  /** Releases `registers`, if there are any. */
  release(registers: readonly Register[], span: AnchoredSpan): void {
    if (registers.length > 0) {
      this.context.code.emit({ kind: 'release', span, registers: [...registers] });
    }
  }

  /** The list what `hold`s keep until `until` ends is kept in (§7). */
  listOf(until: LabelledScope | 'function'): Register {
    const known = this.#lists.get(until);
    if (known !== undefined) {
      return known;
    }
    const list = this.context.code.allocate();
    this.#lists.set(until, list);
    this.#held.add(list);
    return list;
  }

  /** What `future` gave once it settled. */
  givenBy(future: ValueId, span: AnchoredSpan): Register {
    return (
      this.#given.get(future) ??
      unreachable(`What the future at ${span.from} gave is read before it settled.`)
    );
  }

  /** Makes `register` what `future` gave once it settled. */
  give(future: ValueId, register: Register): void {
    this.#given.set(future, register);
    this.#held.add(register);
  }

  /** The wait the `onAwait` calls being written hand their resolvers from, opened by the first. */
  openWait(span: AnchoredSpan): OpenWait {
    this.#wait ??= { wait: this.context.code.wait(span), futures: [] };
    return this.#wait;
  }

  /** The wait opened, which the `await` or `select` written now waits on. */
  takeWait(): OpenWait {
    const wait = this.#wait ?? unreachable('An await waits on no wait opened.');
    this.#wait = undefined;
    return wait;
  }

  // Blocks.

  labelOf(block: BlockId): Label {
    const known = this.#labels.get(block);
    if (known !== undefined) {
      return known;
    }
    const label = this.context.code.newLabel();
    this.#labels.set(block, label);
    return label;
  }

  /** Goes on to `block`: the next pass where it is a field loop's top, unless written next. */
  goTo(block: BlockId, span: AnchoredSpan): void {
    const visit = this.passesHere().find(({ top }) => top === block);
    const target = visit?.next ?? block;
    if (target !== this.#next) {
      this.context.code.jump(this.labelOf(target), span);
    }
  }

  /** Where the field loop whose top is being written goes first. */
  firstPass(): BlockId {
    return this.#layout.firstOf(this.#block);
  }

  /** The passes the block being written is in. */
  passesHere(): readonly PassVisit[] {
    return this.#layout.passesOf(this.#block);
  }

  /** Goes on past the flow, its root's value given into `end.into`. */
  leave(span: AnchoredSpan): void {
    if (this.#next !== undefined) {
      this.context.code.jump(this.#after, span);
    }
  }

  /** The name the innermost statement around `site` gives where it waits (§10). */
  waypointAt(site: NodeOf<string>): string | undefined {
    const { checker, module } = this.context;
    const { tree } = programModule(checker.program, module);
    for (const node of ancestorsOf(tree, site as SyntaxNode)) {
      if (isNested(node)) {
        return undefined;
      }
      const waypoint =
        'annotations' in node
          ? checker.annotations.waypointOf(module, node as Statement)
          : undefined;
      if (waypoint !== undefined) {
        return waypoint;
      }
    }
    return undefined;
  }
}

/** Whether `node` is a function's own: a waypoint outside it is none of its code's. */
function isNested(node: SyntaxNode): boolean {
  return node.kind === 'Lambda' || node.kind === 'FunctionDeclaration';
}

function writerOf(operation: Operation): (writer: FlowWriter, operation: Operation) => void {
  return operationWriters[operation.op] as (writer: FlowWriter, operation: Operation) => void;
}
