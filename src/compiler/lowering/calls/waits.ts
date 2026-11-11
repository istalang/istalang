/**
 * Waiting, the one way lowering writes it (proposal 8, Rule 5): a wait, then for each case, in
 * order, a resolver handed to that case's `onAwait` and let go of at once, so what `onAwait` did
 * with it is all that holds it and one it dropped panics; then the instruction that waits. Code
 * with a body calls each case's `onAwait` as the checker recorded it; synthesized code awaits only
 * futures, through the prelude's.
 */

import type { Register } from '../../../definition/operands.ts';
import { awaitFunction } from '../../../foundation/language/well-known/implicit-calls.ts';
import { wellKnown } from '../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Type } from '../../checker/types/type/index.ts';
import { wellKnownArguments } from '../../checker/types/type/well-known.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { CodeContext } from '../context.ts';
import { rootInstance } from '../tables/instances.ts';
import { emitCall } from './emit-call.ts';

/** A case of a wait: hands its resolver, in `done`, to what it waits on. */
export type WaitCase = (done: Register) => void;

/** Opens a wait on `cases`, by position; the register of the wait. */
export function openWait(
  context: CodeContext,
  cases: readonly WaitCase[],
  span: AnchoredSpan,
): Register {
  const { code } = context;
  const wait = code.wait(span);
  for (const [position, handOver] of cases.entries()) {
    const done = code.resolver(wait, position, span);
    handOver(done);
    code.emit({ kind: 'release', span, registers: [done] });
  }
  return wait;
}

/** Waits until the wait in `wait` is decided; the register of what it gives. */
export function awaitWait(context: CodeContext, wait: Register, span: AnchoredSpan): Register {
  const dst = context.code.allocate();
  context.code.await(dst, wait, span);
  return dst;
}

/** Awaits the future in `future`, of type `type`; the register of its value. */
export function awaitFuture(
  context: CodeContext,
  future: Register,
  type: Type,
  span: AnchoredSpan,
): Register {
  const { checker, tables } = context;
  const parts = wellKnownArguments(checker, wellKnown.future, type);
  const [declaration] = checker.languageFunctions('prelude', awaitFunction);
  if (parts === undefined || declaration === undefined) {
    unreachable(
      `Synthesized code awaits a ${type.kind} type, or the prelude has no future's await.`,
    );
  }
  const callee = tables.functionIndex(rootInstance(checker, declaration, parts));
  const wait = openWait(
    context,
    [(done) => emitCall(context, { span, callee, arguments: [future, done] })],
    span,
  );
  return awaitWait(context, wait, span);
}
