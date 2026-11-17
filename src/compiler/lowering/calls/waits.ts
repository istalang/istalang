/**
 * Waiting, the one way lowering writes it (proposal 8, Rule 5; ir-first design, decision 6).
 *
 * Futures, resolvers and waits are the prelude's Istalang, so lowering writes calls into it around
 * the one instruction that waits:
 * - a wait of the running call (`_wait`), opened by a wait's first case;
 * - for each case, in order, a shared value of the case's type, empty, and the case's resolver
 *   (`_caseResolver`), which puts the value it is resolved with there and decides the wait for the
 *   case's position. The resolver is handed to the case's `onAwait` and let go of at once, so what
 *   `onAwait` did with it is all that holds it, and one it dropped panics;
 * - `park`, which gives the position the wait was decided for; the case at that position takes its
 *   value out of its shared value, leaving it empty: a resolver outliving the wait still reaches
 *   the shared value, and must not keep the value its waiter moved on with (§7).
 *
 * Code with a body calls each case's `onAwait` as the checker recorded it; synthesized code awaits
 * only futures, through the prelude's.
 */

import type { Place } from '../../../definition/instructions/places.ts';
import type { Register } from '../../../definition/operands.ts';
import {
  awaitFunction,
  waitFunctions,
} from '../../../foundation/language/well-known/implicit-calls.ts';
import { type Persistence, wellKnown } from '../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { NominalType, Type } from '../../checker/types/type/index.ts';
import { intType, literalType } from '../../checker/types/type/primitives.ts';
import { wellKnownArguments } from '../../checker/types/type/well-known.ts';
import { optionalOf } from '../../checker/types/unions/unions.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { CodeContext } from '../context.ts';
import { rootInstance } from '../tables/instances.ts';
import { insideOptional, noneOf } from '../values/optionals.ts';
import { construct } from '../values/struct-values.ts';
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
  const instance = preludeInstance(context, waitFunctions.wait, [literalType(mode)]);
  const waitType = wellKnownTypeOf(context, wellKnown.wait, [literalType(mode)]);
  const wait = emitCall(
    context,
    { span, callee: tables.index({ kind: 'instance', instance }), arguments: [handle] },
    tables.types.reference(waitType),
  );
  return { wait, mode, cases: [] };
}

/**
 * The resolver of `open`'s next case, waiting on a value of `type`: it puts its value into the
 * case's shared value and decides the wait for the case's position. Its owner lets go of it once
 * the case's `onAwait` has it.
 */
export function caseResolver(
  context: CodeContext,
  open: OpenWait,
  type: Type,
  span: AnchoredSpan,
): Register {
  const { checker, code, tables } = context;
  const optional = optionalOf(type, checker.typeRules);
  const sharedType = wellKnownTypeOf(context, wellKnown.shared, [optional]);
  const value = checker.sharedValueOf(sharedType) ?? unreachable('Shared holds a shape.');
  const empty = noneOf(context, optional, span);
  const shared = code.allocate(tables.types.reference(sharedType));
  if (value.kind !== 'anonymous' && value.kind !== 'nominal') {
    unreachable('A shared value holds a struct.');
  }
  const struct = construct(context, value, new Map([['value', empty]]), span);
  code.emit({ kind: 'newCell', span, dst: shared, value: code.take(struct, span) });
  code.pin(shared);
  const position = open.cases.length;
  open.cases.push({ shared, type });
  const mode = literalType(open.mode);
  const instance = preludeInstance(context, waitFunctions.caseResolver, [type, mode]);
  const resolverType = wellKnownTypeOf(context, wellKnown.resolver, [type, mode]);
  const at = emitConstantInt(context, position, span);
  return emitCall(
    context,
    {
      span,
      callee: tables.index({ kind: 'instance', instance }),
      arguments: [open.wait, at, shared],
    },
    tables.types.reference(resolverType),
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
  const { code, tables } = context;
  const instance = preludeInstance(context, waitFunctions.parking, [literalType(open.mode)]);
  const unit = tables.types.reference({ kind: 'primitive', name: 'Unit' });
  const parking = emitCall(
    context,
    { span, callee: tables.index({ kind: 'instance', instance }), arguments: [open.wait] },
    unit,
  );
  code.letGo([parking], span);
  return code.park(waypoint, span);
}

/**
 * The position `open` was decided for at once, as a `select` with an `else` asks (§8); -1 where no
 * case decided it, the wait then given up.
 */
export function decidedAt(context: CodeContext, open: OpenWait, span: AnchoredSpan): Register {
  const { tables } = context;
  const instance = preludeInstance(context, waitFunctions.decided, [literalType(open.mode)]);
  return emitCall(
    context,
    { span, callee: tables.index({ kind: 'instance', instance }), arguments: [open.wait] },
    tables.types.reference(intType),
  );
}

/**
 * Takes the value case `position` of `open` was resolved with, once the wait was decided for it, into
 * a register of its own, letting go of the optional that held it.
 */
export function caseValue(
  context: CodeContext,
  open: OpenWait,
  position: number,
  span: AnchoredSpan,
): Register {
  const { checker, code, tables } = context;
  const decided = open.cases[position] ?? unreachable(`A wait has no case ${position}.`);
  const optional = optionalOf(decided.type, checker.typeRules);
  const held = code.allocate(tables.types.reference(optional));
  const place: Place = {
    root: { kind: 'cell', register: decided.shared },
    path: [{ kind: 'field', field: 0 }],
  };
  code.emit({ kind: 'load', span, dst: held, place });
  code.emit({ kind: 'store', span, place, value: noneOf(context, optional, span) });
  const inside = insideOptional(
    context,
    { register: held, type: optional, to: decided.type },
    span,
  );
  const value = code.copy(inside, span);
  code.letGo([held], span);
  return value;
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
  const { checker, tables, code } = context;
  const parts = wellKnownArguments(checker, wellKnown.future, type);
  const [declaration] = checker.languageFunctions('prelude', awaitFunction);
  const [valueType] = parts ?? [];
  if (parts === undefined || declaration === undefined || valueType === undefined) {
    return unreachable(
      `Synthesized code awaits a ${type.kind} type, or the prelude has no future's await.`,
    );
  }
  const open = openWait(context, mode, span);
  const done = caseResolver(context, open, valueType, span);
  const callee = tables.index({
    kind: 'instance',
    instance: rootInstance(checker, declaration, parts),
  });
  const unit = tables.types.reference({ kind: 'primitive', name: 'Unit' });
  const result = emitCall(context, { span, callee, arguments: [future, done] }, unit);
  code.letGo([done, result], span);
  code.letGo([parked(context, open, { waypoint: undefined, span })], span);
  const value = caseValue(context, open, 0, span);
  code.letGo(waitRegisters(open), span);
  return value;
}

/** The instance of the prelude function `name` at `typeArguments`. */
function preludeInstance(context: CodeContext, name: string, typeArguments: readonly Type[]) {
  const [declaration] = context.checker.languageFunctions('prelude', name);
  return declaration === undefined
    ? unreachable(`The prelude declares no '${name}'.`)
    : rootInstance(context.checker, declaration, typeArguments);
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
