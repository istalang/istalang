/**
 * Lowering's table of expression handlers, one per kind (architecture: Registries; docs/arch/
 * definition.md, "How each construct lowers"). Each handler emits the code computing its value and
 * gives the register holding it; construct modules beside this one hold the handlers.
 *
 * Kinds not supported yet share `notLowered`, which a clean check never reaches.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Expression } from '../../syntax/expressions.ts';
import type { Handlers } from '../../syntax/handlers.ts';
import type { FunctionContext } from '../context.ts';
import { notLowered } from '../not-lowered.ts';
import { lowerCall } from './calls.ts';
import { lowerIf } from './control.ts';
import { lowerName } from './names.ts';
import { lowerBinary, lowerUnary } from './operators.ts';
import { lowerFieldRead, lowerStructLiteral } from './structs.ts';

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
  StructLiteral: lowerStructLiteral,
  MemberAccess: lowerFieldRead,
  If: lowerIf,
  DurationLiteral: notLowered,
  NoneLiteral: notLowered,
  ArrayLiteral: notLowered,
  MapLiteral: notLowered,
  Comprehension: notLowered,
  Tuple: notLowered,
  Lambda: notLowered,
  Reference: notLowered,
  Index: notLowered,
  Propagate: notLowered,
  Unwrap: notLowered,
  Await: notLowered,
  Is: notLowered,
  Range: notLowered,
  Match: notLowered,
  Select: notLowered,
  Missing: notLowered,
  Invalid: notLowered,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.
