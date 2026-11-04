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
 * - Own type (`knownTypeHandlers`): for a sibling inside a composite argument, the type it has on
 *   its own without running expression checking or reporting (`acceptedPartOf`).
 */

import { wellKnown } from '../../../language/well-known.ts';
import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import { localFunctionOf } from '../../binder/entities.ts';
import type { Expression, Reference } from '../../syntax/expressions/index.ts';
import type { Identifier } from '../../syntax/node.ts';
import { type Block, tailExpressionOf } from '../../syntax/statements.ts';
import { checkLambda, lambdaAccepts } from '../closures/lambdas.ts';
import type { AcceptedPart, Accepts, BodyContext } from '../context.ts';
import { blockAccepts } from '../rules/branches.ts';
import {
  boolType,
  errorType,
  floatType,
  intType,
  stringType,
  type Type,
  unitType,
} from '../types/type.ts';
import { literalOrBase } from '../types/unions.ts';
import { wellKnownOf } from '../types/well-known.ts';
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
import { checkDereference } from './dereference.ts';
import { checkIndex } from './indexing.ts';
import { checkDurationLiteral } from './literals.ts';
import { checkIs, checkMatch, matchAccepts } from './match.ts';
import { checkMemberAccess, memberAccepts } from './member-access.ts';
import { checkName, nameAccepts, variableType } from './names.ts';
import { checkBinary, checkChainedComparison, checkUnary } from './operators.ts';
import { checkUnwrap } from './optionals.ts';
import { checkPropagate } from './propagate.ts';
import { checkSelect, selectAccepts } from './select.ts';
import { checkSpawn } from './spawn.ts';
import { checkNamedLiteral, checkStructLiteral, structLiteralAccepts } from './structs.ts';
import { checkTemplate } from './templates.ts';
import { checkTuple, checkTupleElement, tupleAccepts } from './tuples.ts';
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
  IntegerLiteral: (_context, node, expected) => literalOrBase(node.value, expected),
  FloatLiteral: () => floatType,
  StringLiteral: (_context, node, expected) => literalOrBase(node.value, expected),
  BooleanLiteral: (_context, node, expected) => literalOrBase(node.value, expected),
  Parenthesized: (context, node, expected) => context.expression(node.expression, expected),
  Binary: checkBinary,
  Unary: checkUnary,
  Call: checkCall,
  StructLiteral: checkStructLiteral,
  NewStructLiteral: checkNamedLiteral,
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
  Spawn: checkSpawn,
  Unwrap: checkUnwrap,
  ChainedComparison: checkChainedComparison,
  TemplateLiteral: checkTemplate,
  Dereference: checkDereference,
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
  NewStructLiteral: ownType,
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
  Lambda: lambdaAccepts,
  Reference: ownType,
  Index: ownType,
  Propagate: ownType,
  Spawn: ownType,
  Unwrap: ownType,
  ChainedComparison: ownType,
  TemplateLiteral: ownType,
  Dereference: ownType,
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

/** A kind whose value depends on checking or on the expected type. */
const unknownType = (): undefined => undefined;

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const knownTypeHandlers: Handlers<BodyContext, Expression, [], Type | undefined> = {
  Identifier: identifierKnownType,
  IntegerLiteral: () => intType,
  FloatLiteral: () => floatType,
  StringLiteral: () => stringType,
  BooleanLiteral: () => boolType,
  Parenthesized: (context, node) => knownTypeOf(context, node.expression),
  Binary: unknownType,
  Unary: unknownType,
  Call: unknownType,
  StructLiteral: unknownType,
  NewStructLiteral: unknownType,
  MemberAccess: unknownType,
  TupleElement: unknownType,
  BlockExpression: (context, node) => blockKnownType(context, node.block),
  If: unknownType,
  DurationLiteral: (context) => wellKnownOf(context.checker, wellKnown.duration),
  NoneLiteral: unknownType,
  ArrayLiteral: unknownType,
  MapLiteral: unknownType,
  Comprehension: unknownType,
  Tuple: (context, node) => tupleKnownType(context, node.elements),
  Lambda: unknownType,
  Reference: unknownType,
  Index: unknownType,
  Propagate: unknownType,
  Spawn: unknownType,
  Unwrap: unknownType,
  ChainedComparison: unknownType,
  TemplateLiteral: (_context, node) => (node.tag === undefined ? stringType : undefined),
  Dereference: unknownType,
  Await: unknownType,
  Is: () => boolType,
  Range: (context) => wellKnownOf(context.checker, wellKnown.range),
  Match: unknownType,
  Select: unknownType,
  Missing: unknownType,
  Invalid: unknownType,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** How `node` takes part in a composite argument's `Accepts` check. */
export function acceptedPartOf(context: BodyContext, node: Expression | undefined): AcceptedPart {
  if (node === undefined) {
    return { kind: 'typed', type: undefined };
  }
  const accepts = context.accepts(node);
  return accepts === undefined
    ? { kind: 'typed', type: knownTypeOf(context, node) }
    : { kind: 'decided', accepts };
}

function knownTypeOf(context: BodyContext, node: Expression): Type | undefined {
  return handlerOf(knownTypeHandlers, node)(context, node);
}

function blockKnownType(context: BodyContext, block: Block): Type | undefined {
  const tail = tailExpressionOf(block);
  return tail !== undefined && block.statements.length === 1
    ? knownTypeOf(context, tail)
    : undefined;
}

function identifierKnownType(context: BodyContext, node: Identifier): Type | undefined {
  const entity = context.entityOf(node);
  if (entity?.kind !== 'variable' || localFunctionOf(entity) !== undefined) {
    return undefined;
  }
  const type = variableType(context, entity);
  return type.kind === 'error' ? undefined : type;
}

function tupleKnownType(context: BodyContext, elements: readonly Expression[]): Type | undefined {
  if (elements.length === 0) {
    return unitType;
  }
  const types: Type[] = [];
  for (const element of elements) {
    const type = knownTypeOf(context, element);
    if (type === undefined) {
      return undefined;
    }
    types.push(type);
  }
  return { kind: 'tuple', elements: types };
}
