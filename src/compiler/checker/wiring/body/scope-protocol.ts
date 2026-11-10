/**
 * The scope protocol (docs/work/variance-inference/i2-scope.md §2): how each kind of expression
 * stands toward the constraint scope it is checked in, one entry per kind, so a kind added to the
 * syntax tree fails to compile until it says. BodyScopes places an expression by it; what reads a
 * part settled instead (a callee, a condition, a subject) says so where it reads it
 * (`BodyContext.settled`), and a field loop's passes each settle on their own (body-checker.ts
 * `fieldPasses`).
 *
 * - A literal written where a part of a joining composite takes it is fresh in the scope
 *   (`BodyContext.part`, rules/placeholders.ts), whatever it stands as here.
 * - An expression the scope may postpone (constructs/expressions/postponed.ts) joins it, however
 *   its kind stands: a lambda, a name of functions or variants, an empty `[]` or `[:]`.
 * - A collection literal of items decided by where it goes, an expected collection type the scope
 *   doesn't hold, reads its items' types at once to agree on them, so they settle on their own; one
 *   that isn't joins as a generic literal of the scope, its items agreeing in any order.
 * - Parentheses open a scope where what they hold would, and otherwise join the current one, so
 *   what they hold is placed as it stands itself: a lambda, a name or `[]` in them is still
 *   postponed.
 * - An `if` with no `else` gives nothing: its branches' values are dropped, so they settle on their
 *   own, as a statement's do.
 * - A deferred call opens as its taker's call does; the call it defers is read settled, as a callee
 *   is, since the function it gives is built from what that call gives.
 */

import { type Handlers, handlerOf } from '../../../../foundation/structures/kind-table.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import type { Type } from '../../types/type/index.ts';

/** How an expression stands toward the current constraint scope. */
export type Standing =
  /** Checked in the current scope, opening one where none is, which settles once it is checked. */
  | 'opens'
  /** Checked in the current scope; where none is open, checked as ever, opening none. */
  | 'joins'
  /** Checked with no scope current, so its parts each settle on their own. */
  | 'boundary'
  /**
   * Checked with no scope current, what it is expected to be read as given: a literal decided by
   * where it goes, whose items settle on their own.
   */
  | 'decided';

/**
 * What the protocol reads of the scopes: whether a type is open in the current one, and whether a
 * collection literal expected to be `expected` has its items' types decided by it, as a type that
 * builds collections (types/fitting/expected.ts `collectionTarget`) does, where `any Sendable`
 * doesn't.
 */
export interface ScopeHolding {
  readonly holds: (type: Type | undefined) => boolean;
  readonly decidesItems: (expected: Type) => boolean;
}

const opens = (): Standing => 'opens';
const boundary = (): Standing => 'boundary';

/** Whether a collection literal of `items` is decided by where it goes, expected as `expected`. */
function collectionStanding(
  scopes: ScopeHolding,
  items: readonly unknown[],
  expected: Type | undefined,
): Standing {
  const isDecided =
    items.length === 0 ||
    (expected !== undefined && !scopes.holds(expected) && scopes.decidesItems(expected));
  return isDecided ? 'decided' : 'opens';
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const standings: Handlers<ScopeHolding, Expression, [Type | undefined], Standing> = {
  Call: opens,
  DeferredCall: opens,
  StructLiteral: opens,
  NewStructLiteral: opens,
  Tuple: opens,
  ArrayLiteral: (scopes, node, expected) => collectionStanding(scopes, node.elements, expected),
  MapLiteral: (scopes, node, expected) => collectionStanding(scopes, node.entries, expected),
  IndentedValue: (_scopes, node) => (node.type === undefined ? 'joins' : 'opens'),
  Parenthesized: (scopes, node, expected) =>
    standingOf(scopes, node.expression, expected) === 'opens' ? 'opens' : 'joins',
  If: (_scopes, node) => (node.elseClause === undefined ? 'boundary' : 'opens'),
  Match: opens,
  Select: opens,
  BlockExpression: opens,
  Identifier: boundary,
  MemberAccess: boundary,
  TypeApplication: boundary,
  Lambda: boundary,
  IntegerLiteral: boundary,
  FloatLiteral: boundary,
  StringLiteral: boundary,
  BooleanLiteral: boundary,
  DurationLiteral: boundary,
  NoneLiteral: boundary,
  TemplateLiteral: boundary,
  Binary: boundary,
  Unary: boundary,
  ChainedComparison: boundary,
  Is: boundary,
  Range: boundary,
  TupleElement: boundary,
  Index: boundary,
  Reference: boundary,
  Dereference: boundary,
  Propagate: boundary,
  Unwrap: boundary,
  Await: boundary,
  Comprehension: boundary,
  FieldComprehension: boundary,
  Missing: boundary,
  Invalid: boundary,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** How `node`, expected to be `expected`, stands toward the current scope. */
export function standingOf(
  scopes: ScopeHolding,
  node: Expression,
  expected: Type | undefined,
): Standing {
  return handlerOf(standings, node)(scopes, node, expected);
}

/**
 * Where `node` is checked: as it stands, or, when the scope may postpone it, in the current scope
 * if any, whatever its kind stands as, so it waits there for what is expected of it.
 */
export function placeOf(
  scopes: ScopeHolding,
  node: Expression,
  expected: Type | undefined,
  postponable: boolean,
): Standing {
  const standing = standingOf(scopes, node, expected);
  return postponable && (standing === 'boundary' || standing === 'decided') ? 'joins' : standing;
}
