/**
 * The variables of one entry (§7.1, §4.5; docs/arch/definition.md, "Frames"): each name it
 * declares lives in a register of its own, whichever flow of the entry writes it, its frame's
 * parameters and captures first. What a variable holds is released where its flow says
 * (writer.ts).
 *
 * - **One register per name and type.** A field loop's passes bind one name to values of several
 *   types (§11.2), each pass in code of its own, so each type gets its register and every register
 *   keeps one type.
 * - **Cells.** A variable passed by `&` somewhere in the body, or a `let` a closure captures, lives
 *   in a cell a reference or a closure can reach (§7.3, §6.4): its register owns the cell, typed
 *   as the `_Cell<T>` it is. A write making the variable anew, where no path reaching it has made
 *   it since its scope last ended, makes a new cell (`declaringWrites`), so each iteration of a loop
 *   declaring it captures its own; any other write stores into the cell.
 */

import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type {
  BlockId,
  FlowFunction,
  FlowValue,
  Operation,
  ValueId,
} from '../../checker/surface/flow-ir.ts';
import { successorsOf } from '../../checker/surface/flow-ir.ts';
import { substitute } from '../../checker/types/parts/substitution.ts';
import type { Type } from '../../checker/types/type/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { FunctionContext } from '../context.ts';
import type { CodeWriter } from '../functions/code-writer.ts';

/** The register each variable of one entry lives in, by its declaring name and type. */
export class VariableRegisters {
  readonly #registers = new Map<Identifier, Map<string, Register>>();
  readonly #variables = new Set<Register>();

  declare(declaring: Identifier, typeKey: string, register: Register): void {
    const byType = this.#registers.get(declaring) ?? new Map<string, Register>();
    this.#registers.set(declaring, byType.set(typeKey, register));
    this.#variables.add(register);
  }

  /** Whether a variable lives in `register`. */
  isVariable(register: Register): boolean {
    return this.#variables.has(register);
  }

  registerOf(declaring: Identifier, typeKey: string): Register | undefined {
    return this.#registers.get(declaring)?.get(typeKey);
  }
}

/**
 * The type the variable `name` holds where the entry reads it: as its body declares it there, as one
 * name holds each pass's field in a field loop (§11.2), else `checked`; read as the entry reads types.
 * A capture is typed so too, as the function it captures may be typed finally only after.
 */
export function variableType(
  context: FunctionContext,
  name: Identifier,
  checked: Type | undefined,
): Type | undefined {
  const type = context.body.declaredTypeOf(name) ?? checked;
  return type === undefined ? undefined : concreteType(context, type);
}

/** `type` as the entry reads it now: its type parameters and field loops' keys substituted. */
export function concreteType(context: FunctionContext, type: Type): Type {
  return substitute(type, context.substitution(), context.checker.typeRules);
}

/** The register the variable `value` of `type` lives in, allocated on its first use. */
export function variableRegister(
  context: FunctionContext,
  value: Extract<FlowValue, { readonly kind: 'variable' }>,
  type: Type,
): Register {
  const known = knownVariableRegister(context, value, type);
  if (known !== undefined) {
    return known;
  }
  const { checker, tables, code, variables } = context;
  const stored = value.inCell ? checker.cellOf(type) : type;
  const register = code.allocate(tables.types.reference(stored));
  variables.declare(value.entity.name, checker.typeKeys.typeKey(type), register);
  return register;
}

/** The register the variable `value` of `type` lives in, if it was used already. */
export function knownVariableRegister(
  context: FunctionContext,
  value: Extract<FlowValue, { readonly kind: 'variable' }>,
  type: Type,
): Register | undefined {
  return context.variables.registerOf(value.entity.name, context.checker.typeKeys.typeKey(type));
}

/**
 * The variables living in cells made once `operations` ran from `made`, which it changes: each
 * write making one anew joins `declaring`, and a release ends one.
 */
function madeAfter(
  operations: readonly Operation[],
  made: Set<ValueId>,
  {
    flow,
    inCell,
    declaring,
  }: {
    readonly flow: FlowFunction;
    readonly inCell: (value: ValueId) => boolean;
    readonly declaring: Set<Operation>;
  },
): Set<ValueId> {
  for (const operation of operations) {
    if (operation.op === 'release') {
      for (const value of operation.values) {
        made.delete(value);
      }
    }
    const written = variableWritten(flow, operation);
    if (written !== undefined && inCell(written)) {
      if (!made.has(written)) {
        declaring.add(operation);
      }
      made.add(written);
    }
  }
  return made;
}

/** What each block `exit` goes on to starts with: a transient test's found branch has its variable. */
function exitStates(
  exit: FlowFunction['blocks'][number]['exit'],
  made: Set<ValueId>,
): [BlockId, Set<ValueId>][] {
  const shared =
    exit.kind === 'branch' && exit.test.kind === 'transient'
      ? { block: exit.to[0], variable: exit.test.variable }
      : undefined;
  return [...successorsOf(exit)].map((next) => [
    next,
    next === shared?.block ? new Set([...made, shared.variable]) : made,
  ]);
}

/** The variable `operation` writes whole: its `into`, or the root of a place it writes with no path. */
function variableWritten(flow: FlowFunction, operation: Operation): ValueId | undefined {
  const written = writtenWhole(operation);
  return written !== undefined && flow.values[written]?.kind === 'variable' ? written : undefined;
}

/** The value `operation` writes whole, if any. */
function writtenWhole(operation: Operation): ValueId | undefined {
  if (operation.op === 'write') {
    return operation.place.path.length === 0 ? operation.place.root : undefined;
  }
  return 'into' in operation ? operation.into : undefined;
}

/**
 * The writes of `flow` making a variable living in a cell anew: those no path reaching makes it
 * before, since the function began or its scope last ended. A variable the function binds as it
 * begins, a parameter, a capture or its own name, is made then; a transient a call it is nested in
 * shares, where the test finding it goes (§7.1).
 */
export function declaringWrites(flow: FlowFunction): ReadonlySet<Operation> {
  const inCell = (value: ValueId) => {
    const flowValue = flow.values[value];
    return flowValue?.kind === 'variable' && flowValue.inCell;
  };
  const bound = [
    ...flow.parameters,
    ...flow.captures,
    ...(flow.self === undefined ? [] : [flow.self]),
  ];
  const entry = new Set(bound.filter(inCell));
  const states = new Map<BlockId, Set<ValueId>>([[0, entry]]);
  const declaring = new Set<Operation>();
  const pending: BlockId[] = [0];
  while (pending.length > 0) {
    const block = pending.pop() ?? 0;
    const { operations, exit } = flow.blocks[block] ?? unreachable(`No block ${block}.`);
    const before = states.get(block) ?? unreachable(`Block ${block} is unreached.`);
    const made = madeAfter(operations, new Set(before), { flow, inCell, declaring });
    for (const [next, out] of exitStates(exit, made)) {
      const known = states.get(next);
      const merged = known === undefined ? out : new Set([...known].filter((v) => out.has(v)));
      if (known === undefined || merged.size !== known.size) {
        states.set(next, merged);
        pending.push(next);
      }
    }
  }
  return declaring;
}

/** A write of a variable living in a cell: what it writes, and whether it makes the cell anew. */
interface CellWrite {
  readonly cell: Register;
  readonly produced: Register;
  readonly declares: boolean;
}

/** Writes `produced` into the variable living in `cell`: into a new cell where the write makes it. */
export function writeCell(
  code: CodeWriter,
  { cell, produced, declares }: CellWrite,
  span: AnchoredSpan,
): void {
  const value = code.take(produced, span);
  if (declares) {
    code.letGo([cell], span);
    code.emit({ kind: 'newCell', span, dst: cell, value });
    return;
  }
  code.emit({
    kind: 'store',
    span,
    place: { root: { kind: 'cell', register: cell }, path: [] },
    value,
  });
}
