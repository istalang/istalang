/**
 * Where bindings are visible: the scoping rules every construct that binds shares (§3.4, §3.11).
 *
 * - `is` bindings exist only where the match is known to have succeeded: the body of an `if`,
 *   `elif` or `while`, a comprehension's body, a case's body after its guard, and the right side
 *   of an `and`. An `or` lets no binding through; it notes the names its sides bound, so a later
 *   use is told why the name is missing rather than that it was never declared.
 * - A loop's variables, a case's pattern bindings and a select case's binding are fresh for their
 *   body alone.
 * - Once a body is bound, its bindings end, so a use after the construct is told its block ended.
 *
 * Each rule lives here once, and every construct binds its body through it.
 */

import type { Comprehension, Expression } from '../syntax/expressions/index.ts';
import type { For } from '../syntax/statements.ts';
import type { LocalBinder } from './local-binder.ts';
import { Scope } from './scope.ts';

type Body = (scope: Scope) => void;

/** Binds a condition and returns the scope its bindings flow into when it holds. */
function bindCondition(binder: LocalBinder, node: Expression, scope: Scope): Scope {
  if (node.kind === 'Parenthesized') {
    return bindCondition(binder, node.expression, scope);
  }
  if (node.kind === 'Is') {
    binder.walk.expression(binder, node.subject, scope);
    const bindings = Scope.nested(scope);
    binder.walk.pattern(binder, node.pattern, scope, { into: bindings });
    return bindings;
  }
  if (node.kind === 'Binary' && node.operator === 'and') {
    return bindCondition(binder, node.right, bindCondition(binder, node.left, scope));
  }
  if (node.kind === 'Binary' && node.operator === 'or') {
    const sides = [
      bindCondition(binder, node.left, scope),
      bindCondition(binder, node.right, scope),
    ];
    const flow = Scope.nested(scope);
    flow.hideUnderOr(sides.flatMap((side) => side.definedSince(scope)));
    return flow;
  }
  if (node.kind === 'Binary') {
    binder.walk.expression(binder, node.left, scope);
    binder.walk.expression(binder, node.right, scope);
  } else {
    binder.walk.expression(binder, node, scope);
  }
  return scope;
}

/** Binds `body` where `condition` holds (in `scope` when there is none), then ends its bindings. */
export function underCondition(
  binder: LocalBinder,
  condition: Expression | undefined,
  scope: Scope,
  body: Body,
): void {
  const flow = condition === undefined ? scope : bindCondition(binder, condition, scope);
  body(flow);
  flow.endUpTo(scope);
}

/** Binds `body` in a fresh scope that `define` fills first, then ends it. */
export function underBindings(scope: Scope, define: Body, body: Body): void {
  const bindings = Scope.nested(scope);
  define(bindings);
  body(bindings);
  bindings.end();
}

/** A loop header, `for` or comprehension: the iterable outside, the variables fresh for `body`. */
export function underLoop(
  binder: LocalBinder,
  node: For | Comprehension,
  scope: Scope,
  body: Body,
): void {
  binder.walk.expression(binder, node.iterable, scope);
  const define = (variables: Scope) => {
    for (const target of node.targets) {
      binder.walk.pattern(binder, target, scope, { into: variables, declaration: node });
    }
  };
  underBindings(scope, define, body);
}
