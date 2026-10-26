/**
 * `x$`, `x.value` and `x$ = v` (§3.8, §3.9): calls to `unwrap(x)` and `rewrap(x, v)`, found like
 * any call by their names and the operand's type. `x$.field = v` and `x$ += v` write part of the
 * unwrapped value, which assigning to a part of a value does, and write it back with `rewrap`
 * (calls/places.ts).
 *
 * - `x.value` on a handle (§3.18), `Shared` included, is the same as `x$`; written as a field read, it calls `unwrap` with no
 *   call written, so its call is recorded as the read's implicit one, apart from a static function
 *   named as a value at the same kind of node.
 * - `v` must fit the type `x$` reads, the result of the `unwrap` a read would call, so it is checked
 *   against that type first: `none` or a value wrapped into `T?` gets its expected type, and a value
 *   that doesn't fit is reported where it is written. A type with a `rewrap` and no `unwrap` is
 *   written whole all the same, the value taking its own type.
 * - `x$ = v` writes the place `x$` whole, so its `rewrap` is recorded as that place's write, as a
 *   `x$` among destructured targets records it (calls/places.ts), and lowering writes both alike.
 */

import { rewrapFunction, unwrapFunction } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Expression, MemberAccess, Unwrap } from '../../syntax/expressions.ts';
import type { Assignment } from '../../syntax/statements.ts';
import { resolveCall, type WrittenArgument } from '../calls/resolve.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { topLevelCandidates } from '../resolution/candidates.ts';
import { implicitCall } from '../resolution/implicit.ts';
import { chooseSilently } from '../resolution/silent-choice.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { useSite } from '../use-site.ts';

export function checkUnwrap(context: BodyContext, node: Unwrap, expected: Type | undefined): Type {
  const operand = byValue(node.operand, context.expression(node.operand));
  return resolveCall(context, {
    site: node,
    name: unwrapFunction,
    candidates: topLevelCandidates(context.checker, context.module, unwrapFunction, [operand.type]),
    arguments: [operand],
    typeArguments: undefined,
    expected,
    form: 'call',
  });
}

/** `x.value` on `handle`, a handle (§3.18): its `unwrap`, recorded as the field read's (§3.8). */
export function checkHandleValue(context: BodyContext, node: MemberAccess, handle: Type): Type {
  const read = implicitCall(context, {
    node,
    role: 'read',
    candidates: topLevelCandidates(context.checker, context.module, unwrapFunction, [handle]),
    arguments: [{ type: handle, passing: 'value' }],
    failure: () => unreachable(`The handle ${typeText(handle)} declares an 'unwrap' taking it.`),
  });
  return read ?? errorType;
}

/** `target$ = value`: the place `target$` written whole with `rewrap`, the assignment's one part. */
export function checkRewrap(context: BodyContext, node: Assignment, target: Unwrap): void {
  const handle = context.expression(target.operand);
  const read = readType(context, byValue(target.operand, handle));
  const type = context.expression(node.value, read);
  const written = read ?? type;
  const wraps = context.fitWritten(type, written, node.value.span);
  implicitCall(context, {
    node: target,
    role: 'write',
    candidates: topLevelCandidates(context.checker, context.module, rewrapFunction, [
      handle,
      written,
    ]),
    arguments: [
      { type: handle, passing: 'value' },
      { type: written, passing: 'value' },
    ],
    failure: () => checkerDiagnostics.notRewrappable(target.span, typeText(handle)),
  });
  context.variables.recordAssigned(node, [{ target, path: [], type, wraps }]);
}

/** The type `x$` reads for the handle `handle`: what the `unwrap` a read would call returns. */
function readType(context: BodyContext, handle: WrittenArgument): Type | undefined {
  const { checker, module } = context;
  const candidates = topLevelCandidates(checker, module, unwrapFunction, [handle.type]);
  const site = useSite(checker, module, handle.node.span);
  return chooseSilently(site, candidates, [{ type: handle.type, passing: 'value' }])?.result;
}

/** `node`, of `type`, passed by value. */
function byValue(node: Expression, type: Type): WrittenArgument {
  return { node, passing: 'value', type };
}
