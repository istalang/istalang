/**
 * `x$` and `x$ = v` (§3.9): calls to `unwrap(x)` and `rewrap(x, v)`, found like any call by their
 * names and the operand's type. `x$.field = v` and `x$ += v` write part of the unwrapped value,
 * which assigning to a part of a value does, and write it back with `rewrap` (rules/places.ts).
 *
 * `v` must fit the type `x$` reads, the result of the `unwrap` a read would call, so it is checked
 * against that type first: `none` or a value wrapped into `T?` gets its expected type, and a value
 * that doesn't fit is reported where it is written.
 */

import { rewrapFunction, unwrapFunction } from '../../../language/well-known.ts';
import type { Expression, Unwrap } from '../../syntax/expressions.ts';
import type { Assignment } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import { topLevelCandidates } from '../overloads/candidates.ts';
import { resolveCall, type WrittenArgument } from '../overloads/resolve.ts';
import { chooseSilently } from '../overloads/silent-choice.ts';
import type { Type } from '../types/type.ts';
import { useSite } from '../use-site.ts';

export function checkUnwrap(context: BodyContext, node: Unwrap, expected: Type | undefined): Type {
  const operand = byValue(node.operand, context.expression(node.operand));
  return callNamed(context, { site: node, name: unwrapFunction, written: [operand], expected });
}

/** `target$ = value`, recorded on the assignment as the call to `rewrap`. */
export function checkRewrap(context: BodyContext, node: Assignment, target: Unwrap): void {
  const handle = byValue(target.operand, context.expression(target.operand));
  const read = readType(context, handle);
  const value = byValue(node.value, read ?? context.expression(node.value));
  if (read !== undefined) {
    context.expect(node.value, read);
  }
  const written = [handle, value];
  callNamed(context, { site: node, name: rewrapFunction, written, expected: undefined });
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

/** A call written as `$`: to the function of `name`, at `site`. */
interface NamedCall {
  readonly site: Unwrap | Assignment;
  readonly name: string;
  readonly written: readonly WrittenArgument[];
  readonly expected: Type | undefined;
}

function callNamed(context: BodyContext, { site, name, written, expected }: NamedCall): Type {
  const { checker } = context;
  const types = written.map(({ type }) => type);
  return resolveCall(context, {
    site,
    name,
    candidates: topLevelCandidates(checker, context.module, name, types),
    arguments: written,
    typeArguments: undefined,
    expected,
    form: 'call',
  });
}
