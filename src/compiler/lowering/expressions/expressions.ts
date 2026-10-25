/**
 * Lowering's table of expression handlers, one per kind (architecture: Registries; docs/arch/
 * definition.md, "How each construct lowers"). Each handler emits the code computing its value and
 * gives the register holding it; construct modules beside this one hold the handlers.
 *
 * Kinds not supported yet share `notLowered`, which a clean check never reaches.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Handlers } from '../../../structures/kind-table.ts';
import type { Expression } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';
import { notLowered } from '../not-lowered.ts';
import { lowerAwait } from './await.ts';
import { lowerCall } from './calls.ts';
import { lowerArrayLiteral, lowerIndex, lowerMapLiteral, lowerRange } from './collections.ts';
import { lowerComprehension } from './comprehensions.ts';
import { lowerIf } from './control.ts';
import { lowerDurationLiteral } from './literals.ts';
import { lowerName } from './names.ts';
import { lowerBinary, lowerUnary } from './operators.ts';
import { lowerFieldRead, lowerStructLiteral } from './structs.ts';
import { lowerTuple, lowerTupleElement } from './tuples.ts';
import { lowerUnwrap } from './unwrap.ts';
import { isEnum, lowerFieldlessVariant, lowerNone, lowerVariantLiteral } from './variants.ts';

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
    isEnum(context.body.typeOf(node))
      ? lowerVariantLiteral(context, node)
      : lowerStructLiteral(context, node),
  MemberAccess: (context, node) =>
    context.entityOf(node.member)?.kind === 'variant'
      ? lowerFieldlessVariant(context, node, node.member.text)
      : lowerFieldRead(context, node),
  TupleElement: lowerTupleElement,
  If: lowerIf,
  DurationLiteral: lowerDurationLiteral,
  NoneLiteral: lowerNone,
  ArrayLiteral: lowerArrayLiteral,
  MapLiteral: lowerMapLiteral,
  Comprehension: lowerComprehension,
  Tuple: lowerTuple,
  Lambda: notLowered,
  Reference: notLowered,
  Index: lowerIndex,
  Propagate: notLowered,
  Unwrap: lowerUnwrap,
  Await: lowerAwait,
  Is: notLowered,
  Range: lowerRange,
  Match: notLowered,
  Select: notLowered,
  Missing: notLowered,
  Invalid: notLowered,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.
