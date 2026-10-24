/**
 * The checker's table of expression handlers, one per kind (architecture: Registries). Each takes
 * the body's context, the node, and the type its position expects, and gives the node's type; the
 * context records it.
 *
 * Kinds the checker doesn't handle yet share one handler that reports them as not supported. A
 * feature slice replaces its kinds' entries with real handlers.
 */

import type { Handlers } from '../../../structures/kind-table.ts';
import type { Expression, Reference } from '../../syntax/expressions.ts';
import type { BodyContext } from '../context.ts';
import { boolType, errorType, floatType, intType, stringType, type Type } from '../types/type.ts';
import { unsupportedHandler as unsupported } from '../unsupported.ts';
import { checkAwait } from './await.ts';
import { checkCall } from './calls.ts';
import { checkIf } from './control.ts';
import { checkDurationLiteral } from './literals.ts';
import { checkName } from './names.ts';
import { checkBinary, checkUnary } from './operators.ts';
import { checkMemberAccess, checkStructLiteral } from './structs.ts';
import { checkTuple, checkTupleElement } from './tuples.ts';
import { checkUnwrap } from './unwrap.ts';
import { checkNone } from './variants.ts';

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
  ArrayLiteral: unsupported,
  MapLiteral: unsupported,
  Comprehension: unsupported,
  Tuple: checkTuple,
  Lambda: unsupported,
  Reference: misplacedReference,
  Index: unsupported,
  Propagate: unsupported,
  Unwrap: checkUnwrap,
  Await: checkAwait,
  Is: unsupported,
  Range: unsupported,
  Match: unsupported,
  Select: unsupported,
  Missing: alreadyReported,
  Invalid: alreadyReported,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.
