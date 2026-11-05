/**
 * Lowering's table of expression handlers, one per kind (architecture: Registries; docs/arch/
 * definition.md, "How each construct lowers"). Each handler emits the code computing its value and
 * gives the register holding it; construct modules beside this one hold the handlers.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Handlers } from '../../../structures/kind-table.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Expression, MemberAccess } from '../../syntax/expressions/index.ts';
import type { FunctionContext } from '../context.ts';
import { neverLowered } from '../never-lowered.ts';
import { noneOf } from '../optionals.ts';
import { lowerDereference } from '../places.ts';
import { lowerAwait } from './await.ts';
import { lowerCall, lowerSpawn } from './calls.ts';
import { lowerFunctionValue, lowerLambda } from './closures.ts';
import { lowerArrayLiteral, lowerIndex, lowerMapLiteral, lowerRange } from './collections.ts';
import { lowerComprehension, lowerFieldComprehension } from './comprehensions.ts';
import { lowerIf } from './control.ts';
import { lowerDurationLiteral } from './literals.ts';
import { lowerIs, lowerMatch } from './matching.ts';
import { lowerName, lowerNamed } from './names.ts';
import { lowerBinary, lowerChainedComparison, lowerUnary } from './operators.ts';
import { lowerPropagate } from './propagate.ts';
import { lowerSelect } from './select.ts';
import {
  lowerFieldRead,
  lowerNewStructLiteral,
  lowerStructLiteral,
  readsField,
} from './structs.ts';
import { lowerTemplate } from './templates.ts';
import { lowerTuple, lowerTupleElement } from './tuples.ts';
import { lowerUnwrap } from './unwrap.ts';
import { isEnum, lowerVariantLiteral } from './variants.ts';

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const expressionHandlers: Handlers<FunctionContext, Expression, [], Register> = {
  Identifier: lowerName,
  IntegerLiteral: (context, node) => context.constant(node.value, node.span),
  FloatLiteral: (context, node) => context.constant(node.value, node.span),
  StringLiteral: (context, node) => context.constant(node.value, node.span),
  BooleanLiteral: (context, node) => context.constant(node.value, node.span),
  Parenthesized: (context, node) => context.expression(node.expression),
  BlockExpression: (context, node) => context.block(node.block),
  Binary: lowerBinary,
  Unary: lowerUnary,
  Call: lowerCall,
  StructLiteral: (context, node) =>
    isEnum(context.typeOf(node))
      ? lowerVariantLiteral(context, node)
      : lowerStructLiteral(context, node),
  NewStructLiteral: lowerNewStructLiteral,
  IndentedValue: (context, node) =>
    context.expression(
      context.body.builtLiteralOf(node) ??
        unreachable('An indented value is lowered once checked.'),
    ),
  MemberAccess: lowerMemberAccess,
  TupleElement: lowerTupleElement,
  If: lowerIf,
  DurationLiteral: lowerDurationLiteral,
  NoneLiteral: (context, node) => noneOf(context, context.typeOf(node), node.span),
  ArrayLiteral: lowerArrayLiteral,
  MapLiteral: lowerMapLiteral,
  Comprehension: lowerComprehension,
  FieldComprehension: lowerFieldComprehension,
  Tuple: lowerTuple,
  Lambda: lowerLambda,
  Reference: neverLowered,
  Index: lowerIndex,
  Propagate: lowerPropagate,
  Spawn: lowerSpawn,
  Unwrap: lowerUnwrap,
  ChainedComparison: lowerChainedComparison,
  TemplateLiteral: lowerTemplate,
  Dereference: lowerDereference,
  Await: lowerAwait,
  Is: lowerIs,
  Range: lowerRange,
  Match: lowerMatch,
  Select: lowerSelect,
  Missing: neverLowered,
  Invalid: neverLowered,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/**
 * `a.b`: a function named as a value through a namespace or its type (closures.ts), anything else
 * a qualified member names, such as a variant or a namespace's constant, read as its name reads
 * (names.ts), or a field read.
 */
function lowerMemberAccess(context: FunctionContext, node: MemberAccess): Register {
  if (context.body.resolved.has(node)) {
    return lowerFunctionValue(context, node);
  }
  return readsField(context, node)
    ? lowerFieldRead(context, node)
    : lowerNamed(context, node.member, node);
}
