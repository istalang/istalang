/**
 * The checker's table over expression kinds, one entry per kind (architecture: Registries): each
 * handler takes the body's context, the node, and the type its position expects, and gives the
 * node's type; the context records it. What an expression a constraint scope checks only once it
 * knows what is expected of it can be a value of is read in postponed.ts.
 */

import type { Handlers } from '../../../../foundation/structures/kind-table.ts';
import type { Reference } from '../../../syntax/expressions/calls.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType, floatType } from '../../types/type/primitives.ts';
import { literalOrBase } from '../../types/unions/unions.ts';
import { checkAppliedFunction } from '../closures/function-values.ts';
import { checkLambda } from '../closures/lambdas.ts';
import { checkDereference } from './access/dereference.ts';
import { checkIndex } from './access/indexing.ts';
import { checkMemberAccess } from './access/member-access.ts';
import { checkName } from './access/names.ts';
import { checkCall } from './calls.ts';
import { checkComprehension, checkFieldComprehension } from './collections/comprehensions.ts';
import { checkArray, checkMap } from './collections/joining-literals.ts';
import { checkRange } from './collections/literals.ts';
import { checkAwait } from './control/await.ts';
import { checkIf } from './control/control.ts';
import { checkIs, checkMatch } from './control/match.ts';
import { checkPropagate } from './control/propagate.ts';
import { checkSelect } from './control/select.ts';
import { checkIndentedValue } from './literals/indented-values.ts';
import { checkDurationLiteral } from './literals/literals.ts';
import { checkTemplate } from './literals/templates.ts';
import { checkTuple, checkTupleElement } from './literals/tuples.ts';
import { checkBinary, checkChainedComparison, checkUnary } from './operators/operators.ts';
import { checkNamedLiteral, checkStructLiteral } from './structs/structs.ts';
import { checkNone } from './structs/variants.ts';

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
  IntegerLiteral: (context, node, expected) =>
    literalOrBase(node.value, expected, context.checker.fitting),
  FloatLiteral: () => floatType,
  StringLiteral: (context, node, expected) =>
    literalOrBase(node.value, expected, context.checker.fitting),
  BooleanLiteral: (context, node, expected) =>
    literalOrBase(node.value, expected, context.checker.fitting),
  Parenthesized: (context, node, expected) => context.expression(node.expression, expected),
  Binary: checkBinary,
  Unary: checkUnary,
  Call: checkCall,
  StructLiteral: checkStructLiteral,
  NewStructLiteral: checkNamedLiteral,
  IndentedValue: checkIndentedValue,
  MemberAccess: checkMemberAccess,
  TypeApplication: checkAppliedFunction,
  TupleElement: checkTupleElement,
  BlockExpression: (context, node, expected) => context.block(node.block, expected),
  If: checkIf,
  DurationLiteral: checkDurationLiteral,
  NoneLiteral: checkNone,
  ArrayLiteral: checkArray,
  MapLiteral: checkMap,
  Comprehension: checkComprehension,
  FieldComprehension: checkFieldComprehension,
  Tuple: checkTuple,
  Lambda: checkLambda,
  Reference: misplacedReference,
  Index: checkIndex,
  Propagate: checkPropagate,
  DeferredCall: (context, node, expected) => context.sugars.check(context, node, expected),
  Unwrap: (context, node, expected) => context.sugars.check(context, node, expected),
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
