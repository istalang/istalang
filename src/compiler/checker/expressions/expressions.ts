/**
 * The checker's tables over expression kinds, one entry per kind (architecture: Registries).
 *
 * - Checking: each handler takes the body's context, the node, and the type its position expects,
 *   and gives the node's type; the context records it.
 * - Accepting: passed to a call, an expression with no type of its own has the type the chosen
 *   function decides (§3.5), so choosing asks it which parameter types it can take. Each kind says
 *   beside its own rules: `none`, a bare variant, a lambda with a parameter to infer, functions
 *   named by a name of several or a generic one, and an empty `[]` or `[:]`; a tuple, collection
 *   literal or branching expression holding one, unless what it agrees on is decided by a part with
 *   a type of its own. A part still to be inferred can be anything.
 */

import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import type { Expression, Reference } from '../../syntax/expressions.ts';
import { checkLambda, lambdaAccepts } from '../closures/lambdas.ts';
import type { BodyContext } from '../context.ts';
import type { Accepts } from '../resolution/choice.ts';
import { blockAccepts } from '../rules/branches.ts';
import { boolType, errorType, floatType, intType, stringType, type Type } from '../types/type.ts';
import { checkAwait } from './await.ts';
import { checkCall } from './calls.ts';
import {
  arrayAccepts,
  checkArrayLiteral,
  checkMapLiteral,
  checkRange,
  mapAccepts,
} from './collections.ts';
import { checkComprehension } from './comprehensions.ts';
import { checkIf, ifAccepts } from './control.ts';
import { checkIndex } from './indexing.ts';
import { checkDurationLiteral } from './literals.ts';
import { checkIs, checkMatch, matchAccepts } from './match.ts';
import { checkName, nameAccepts } from './names.ts';
import { checkBinary, checkUnary } from './operators.ts';
import { checkPropagate } from './propagate.ts';
import { checkSelect, selectAccepts } from './select.ts';
import {
  checkMemberAccess,
  checkStructLiteral,
  memberAccepts,
  structLiteralAccepts,
} from './structs.ts';
import { checkTuple, checkTupleElement, tupleAccepts } from './tuples.ts';
import { checkUnwrap } from './unwrap.ts';
import { checkNone, noneAccepted } from './variants.ts';

/** Missing and invalid nodes were reported by the parser. */
const alreadyReported = (): Type => errorType;

/**
 * `&x` anywhere but a whole call argument, which the call checks (calls.ts): the parser reported
 * it, so only `x` is checked, for what else it may hold.
 */
const misplacedReference = (context: BodyContext, node: Reference): Type => {
  context.expression(node.expression);
  return errorType;
};

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const expressionHandlers: Handlers<BodyContext, Expression, [Type | undefined], Type> = {
  Identifier: checkName,
  IntegerLiteral: () => intType,
  FloatLiteral: () => floatType,
  StringLiteral: () => stringType,
  BooleanLiteral: () => boolType,
  Parenthesized: (context, node, expected) => context.expression(node.expression, expected),
  Binary: checkBinary,
  Unary: checkUnary,
  Call: checkCall,
  StructLiteral: checkStructLiteral,
  MemberAccess: checkMemberAccess,
  TupleElement: checkTupleElement,
  BlockExpression: (context, node, expected) => context.block(node.block, expected),
  If: checkIf,
  DurationLiteral: checkDurationLiteral,
  NoneLiteral: checkNone,
  ArrayLiteral: checkArrayLiteral,
  MapLiteral: checkMapLiteral,
  Comprehension: checkComprehension,
  Tuple: checkTuple,
  Lambda: checkLambda,
  Reference: misplacedReference,
  Index: checkIndex,
  Propagate: checkPropagate,
  Unwrap: checkUnwrap,
  Await: checkAwait,
  Is: checkIs,
  Range: checkRange,
  Match: checkMatch,
  Select: checkSelect,
  Missing: alreadyReported,
  Invalid: alreadyReported,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** A kind whose value has a type of its own, which takes part in choosing like any argument's. */
const ownType = (): undefined => undefined;

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const acceptsHandlers: Handlers<BodyContext, Expression, [], Accepts | undefined> = {
  Identifier: nameAccepts,
  IntegerLiteral: ownType,
  FloatLiteral: ownType,
  StringLiteral: ownType,
  BooleanLiteral: ownType,
  Parenthesized: (context, node) => context.accepts(node.expression),
  Binary: ownType,
  Unary: ownType,
  Call: ownType,
  StructLiteral: structLiteralAccepts,
  MemberAccess: memberAccepts,
  TupleElement: ownType,
  BlockExpression: (context, node) => blockAccepts(context, node.block),
  If: ifAccepts,
  DurationLiteral: ownType,
  NoneLiteral: noneAccepted,
  ArrayLiteral: arrayAccepts,
  MapLiteral: mapAccepts,
  Comprehension: ownType,
  Tuple: tupleAccepts,
  Lambda: (_context, node) => lambdaAccepts(node),
  Reference: ownType,
  Index: ownType,
  Propagate: ownType,
  Unwrap: ownType,
  Await: ownType,
  Is: ownType,
  Range: ownType,
  Match: matchAccepts,
  Select: selectAccepts,
  Missing: ownType,
  Invalid: ownType,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/**
 * Which parameter types `node` can take when the call it is passed to decides its type; undefined
 * when it has a type of its own.
 */
export function acceptsOf(context: BodyContext, node: Expression): Accepts | undefined {
  const accepts = handlerOf(acceptsHandlers, node)(context, node);
  return accepts && ((expected, isOpen) => isOpen(expected) || accepts(expected, isOpen));
}
