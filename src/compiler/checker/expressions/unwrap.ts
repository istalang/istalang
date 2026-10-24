/**
 * `x$` and `x$ = v` (§3.9): calls to `unwrap(x)` and `rewrap(x, v)`, found like any call by their
 * names and the operand's type. `x$.field = v` and `x$ += v` write part of the unwrapped value,
 * which assigning to a part of a value does.
 */

import { rewrapFunction, unwrapFunction } from '../../../language/well-known.ts';
import type { Expression, Unwrap } from '../../syntax/expressions.ts';
import type { Assignment } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import { topLevelCandidates } from '../overloads/candidates.ts';
import { resolveCall, type WrittenArgument } from '../overloads/resolve.ts';
import type { Type } from '../types/type.ts';

export function checkUnwrap(context: BodyContext, node: Unwrap, expected: Type | undefined): Type {
  const operand = byValue(node.operand, context.expression(node.operand));
  return callNamed(context, { site: node, name: unwrapFunction, written: [operand], expected });
}

/** `target$ = value`, recorded on the assignment as the call to `rewrap`. */
export function checkRewrap(context: BodyContext, node: Assignment, target: Unwrap): void {
  const handle = byValue(target.operand, context.expression(target.operand));
  const value = byValue(node.value, context.expression(node.value));
  const written = [handle, value];
  callNamed(context, { site: node, name: rewrapFunction, written, expected: undefined });
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
