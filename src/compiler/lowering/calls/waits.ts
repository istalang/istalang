/**
 * Waiting, the one way lowering writes it (proposal 8, Rule 5; ir-first design, decision 6).
 *
 * Futures, resolvers and waits are the prelude's Istalang, so lowering writes calls into it around
 * the one instruction that waits:
 * - a wait of the running call (`_wait`), opened by a wait's first case;
 * - for each case, at its position, a shared value holding none of the case's type yet (`_caseInto`),
 *   and the case's resolver (`_caseResolver`), which puts the value it is resolved with there and
 *   decides the wait for the case's position. The resolver is handed to the case's `onAwait` and
 *   let go of at once, so what `onAwait` did with it is all that holds it, and one it dropped panics;
 * - `park`, which gives the position the wait was decided for; the case at that position takes its
 *   value out of its shared value (`_caseTaken`), leaving it empty: a resolver outliving the wait
 *   still reaches the shared value, and must not keep the value its waiter moved on with (§7).
 *
 * A case's shared value is an array, never an optional, so none of this names a union of the
 * case's type, and one instance of each serves every type of one lifetime (§3.5, tables/stencils.ts).
 *
 * Code with a body calls each case's `onAwait` as the checker recorded it; synthesized code awaits
 * only futures, through the prelude's.
 */

import type { Register } from '../../../definition/operands.ts';
import {
  awaitFunction,
  waitFunctions,
} from '../../../foundation/language/well-known/implicit-calls.ts';
import { type Persistence, wellKnown } from '../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { NominalType, Type } from '../../checker/types/type/index.ts';
import { intType, literalType, unitType } from '../../checker/types/type/primitives.ts';
import { wellKnownArguments } from '../../checker/types/type/well-known.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { CodeContext } from '../context.ts';
import { rootInstance } from '../tables/instances.ts';
import { emitCall } from './emit-call.ts';

/** A wait being written: its register, its kind, and each case's shared value, by position. */
export interface OpenWait {
  readonly wait: Register;
  readonly mode: Persistence;
  readonly cases: { readonly shared: Register; readonly type: Type }[];
}

/** A new wait of the running call, of `mode`. */
export function openWait(context: CodeContext, mode: Persistence, span: AnchoredSpan): OpenWait {
  const { code, tables } = context;
  const call = wellKnownTypeOf(context, wellKnown.call, []);
  const handle = code.borrow(tables.types.reference(call));
  code.emit({ kind: 'currentCall', span, dst: handle });
  const kind = [literalType(mode)];
  const wait = callPrelude(
    context,
    {
      name: waitFunctions.wait,
      typeArguments: kind,
      arguments: [handle],
      result: wellKnownTypeOf(context, wellKnown.wait, kind),
    },
    span,
  );
  return { wait, mode, cases: [] };
}

/** A case of a wait: what its awaitable gives once it settles, and the case's position. */
interface WaitCase {
  readonly type: Type;
  readonly position: number;
}

/**
 * The resolver of `open`'s case at `position`, waiting on a value of `type`: it puts its value into
 * the case's shared value and decides the wait for the case's position. Its owner lets go of it
 * once the case's `onAwait` has it.
 */
export function caseResolver(
  context: CodeContext,
  open: OpenWait,
  { type, position }: WaitCase,
  span: AnchoredSpan,
): Register {
  const { code } = context;
  const into = wellKnownTypeOf(context, wellKnown.shared, [arrayOf(context, type)]);
  const shared = callPrelude(
    context,
    { name: waitFunctions.caseInto, typeArguments: [type], result: into },
    span,
  );
  code.pin(shared);
  open.cases[position] = { shared, type };
  const mode = literalType(open.mode);
  const resolverType = wellKnownTypeOf(context, wellKnown.resolver, [type, mode]);
  const at = emitConstantInt(context, position, span);
  return callPrelude(
    context,
    {
      name: waitFunctions.caseResolver,
      typeArguments: [type, mode],
      arguments: [open.wait, at, shared],
      result: resolverType,
    },
    span,
  );
}

/**
 * Parks the running call until `open` is decided, every case known as it stops (`_parking`); the
 * position it was decided for.
 */
export function parked(
  context: CodeContext,
  open: OpenWait,
  { waypoint, span }: { readonly waypoint: string | undefined; readonly span: AnchoredSpan },
): Register {
  const parking = callPrelude(
    context,
    {
      name: waitFunctions.parking,
      typeArguments: [literalType(open.mode)],
      arguments: [open.wait],
      result: unitType,
    },
    span,
  );
  context.code.letGo([parking], span);
  return context.code.park(waypoint, span);
}

/**
 * The position `open` was decided for at once, as a `select` with an `else` asks (§8); -1 where no
 * case decided it, the wait then given up.
 */
export function decidedAt(context: CodeContext, open: OpenWait, span: AnchoredSpan): Register {
  return callPrelude(
    context,
    {
      name: waitFunctions.decided,
      typeArguments: [literalType(open.mode)],
      arguments: [open.wait],
      result: intType,
    },
    span,
  );
}

/**
 * Takes the value case `position` of `open` was resolved with, once the wait was decided for it, into
 * a register of its own, the case's shared value left empty.
 */
export function caseValue(
  context: CodeContext,
  open: OpenWait,
  position: number,
  span: AnchoredSpan,
): Register {
  const decided = open.cases[position] ?? unreachable(`A wait has no case ${position}.`);
  return callPrelude(
    context,
    {
      name: waitFunctions.caseTaken,
      typeArguments: [decided.type],
      arguments: [decided.shared],
      result: decided.type,
    },
    span,
  );
}

/** What `open` holds once decided: its wait and its cases' shared values, to be let go of. */
export function waitRegisters(open: OpenWait): readonly Register[] {
  return [open.wait, ...open.cases.map(({ shared }) => shared)];
}

/** Awaits the future in `future`, of type `type`, in code of `mode`; the register of its value. */
export function awaitFuture(
  context: CodeContext,
  {
    future,
    type,
    mode,
  }: { readonly future: Register; readonly type: Type; readonly mode: Persistence },
  span: AnchoredSpan,
): Register {
  const { checker, code } = context;
  const parts = wellKnownArguments(checker, wellKnown.future, type);
  const [valueType] = parts ?? [];
  if (parts === undefined || valueType === undefined) {
    return unreachable(`Synthesized code awaits a ${type.kind} type.`);
  }
  const open = openWait(context, mode, span);
  const done = caseResolver(context, open, { type: valueType, position: 0 }, span);
  const result = callPrelude(
    context,
    { name: awaitFunction, typeArguments: parts, arguments: [future, done], result: unitType },
    span,
  );
  code.letGo([done, result], span);
  code.letGo([parked(context, open, { waypoint: undefined, span })], span);
  const value = caseValue(context, open, 0, span);
  code.letGo(waitRegisters(open), span);
  return value;
}

/** A call lowering makes of a prelude function: its name, type arguments, arguments and result. */
interface PreludeCall {
  readonly name: string;
  readonly typeArguments: readonly Type[];
  readonly arguments?: readonly Register[];
  readonly result: Type;
}

/** Calls the prelude function `call` names, as it says; the register of what it gives. */
function callPrelude(context: CodeContext, call: PreludeCall, span: AnchoredSpan): Register {
  const { checker, tables } = context;
  const [declaration] = checker.languageFunctions('prelude', call.name);
  if (declaration === undefined) {
    return unreachable(`The prelude declares no '${call.name}'.`);
  }
  const instance = rootInstance(checker, declaration, call.typeArguments);
  return emitCall(
    context,
    {
      span,
      callee: tables.index({ kind: 'instance', instance }),
      arguments: [...(call.arguments ?? [])],
    },
    tables.types.reference(call.result),
  );
}

/** `Array<T>` for `type`. */
function arrayOf(context: CodeContext, type: Type): NominalType {
  return wellKnownTypeOf(context, wellKnown.array, [type]);
}

function wellKnownTypeOf(
  context: CodeContext,
  declaration: (typeof wellKnown)[keyof typeof wellKnown],
  typeArguments: readonly Type[],
): NominalType {
  return (
    context.checker.wellKnownType(declaration, typeArguments) ??
    unreachable(`The program lacks ${declaration.name}.`)
  );
}

function emitConstantInt(context: CodeContext, value: number, span: AnchoredSpan): Register {
  return context.code.constant(
    context.tables.constant(BigInt(value)),
    context.tables.types.reference(intType),
    span,
  );
}
