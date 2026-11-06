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
 * Each rule lives here once, and every construct binds its body through it. So does where in the
 * construct its bindings start to be visible, which is noted on the construct (visibility.ts): a
 * spot inside it that no inner node holds, such as a blank line before its body's first statement,
 * still sees them.
 */

import type {
  Comprehension,
  ConditionalBranch,
  Expression,
  MatchCase,
  SelectCase,
} from '../../syntax/expressions/index.ts';
import { type AnchoredSpan, endOf } from '../../syntax/positions.ts';
import type { For, OverFields, While } from '../../syntax/statements.ts';
import type { LocalBinder } from './local-binder.ts';
import { Scope } from './scope.ts';

type Body = (scope: Scope) => void;

/** A construct whose body runs where its condition holds. */
type Conditional = ConditionalBranch | While | Comprehension | MatchCase;

/** A construct whose body sees bindings of its own. */
type Binding = For | OverFields | Comprehension | MatchCase | SelectCase;

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
    const left = bindCondition(binder, node.left, scope);
    binder.enter(node, left, endOf(node.left.span));
    return bindCondition(binder, node.right, left);
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

/** An `is` or `and`/`or` used as a value: its bindings reach only its own right-hand sides. */
export function bindConditionValue(binder: LocalBinder, node: Expression, scope: Scope): void {
  bindCondition(binder, node, scope).endUpTo(scope);
}

/**
 * Binds `node`'s body where its condition holds (in `scope` when it has none), then ends its
 * bindings. They are visible from the condition's end.
 */
export function underCondition(
  binder: LocalBinder,
  node: Conditional,
  scope: Scope,
  body: Body,
): void {
  const condition = node.kind === 'MatchCase' ? node.guard : node.condition;
  const flow = condition === undefined ? scope : bindCondition(binder, condition, scope);
  if (condition !== undefined) {
    binder.enter(node, flow, endOf(condition.span));
  }
  body(flow);
  flow.endUpTo(scope);
}

/**
 * How a construct with bindings of its own is bound: `define` fills them, then `body` sees them.
 */
interface BindingSteps {
  readonly define: Body;
  readonly body: Body;
}

/** Binds `node`'s body in a fresh scope that its bindings fill first, then ends it. */
export function underBindings(
  binder: LocalBinder,
  node: Binding,
  scope: Scope,
  { define, body }: BindingSteps,
): void {
  const bindings = Scope.nested(scope);
  define(bindings);
  binder.enter(node, bindings, bindingsStartOf(node));
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
  underBindings(binder, node, scope, { define, body });
}

/**
 * A construct over a struct's fields (§4): its header's subject outside, its key and value fresh
 * for `body`, from the subject on to the construct's end, as a `for`'s variables are.
 */
export function underFields(binder: LocalBinder, node: OverFields, scope: Scope, body: Body): void {
  const { header } = node;
  binder.walk.expression(binder, header.subject, scope);
  const define = (variables: Scope) => {
    for (const target of [header.key, header.value]) {
      binder.walk.pattern(binder, target, scope, { into: variables, declaration: header });
    }
  };
  underBindings(binder, node, scope, { define, body });
}

/** Where a construct's own bindings start to be visible: after what declares them. */
function bindingsStartOf(node: Binding): AnchoredSpan {
  switch (node.kind) {
    case 'MatchCase':
      return endOf(node.pattern.span);
    case 'SelectCase':
      return endOf((node.binding ?? node.future).span);
    case 'FieldLoop':
    case 'FieldComprehension':
    case 'StructComprehension':
      return endOf(node.header.subject.span);
    default:
      return endOf(node.iterable.span);
  }
}
