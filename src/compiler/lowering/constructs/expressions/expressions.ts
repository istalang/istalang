/**
 * Lowering's table of expression handlers, one per kind (architecture: Registries; docs/arch/
 * definition.md, "How each construct lowers"). Each handler emits the code computing its value and
 * gives the register holding it; construct modules beside this one hold the handlers.
 */

import type { Register } from '../../../../definition/operands.ts';
import type { Handlers } from '../../../../foundation/structures/kind-table.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { CoreExpression } from '../../../checker/surface/checked-body.ts';
import type { MemberAccess } from '../../../syntax/expressions/index.ts';
import type { FunctionContext } from '../../context.ts';
import { noneOf } from '../../values/optionals.ts';
import { neverLowered } from '../never-lowered.ts';
import { lowerDereference } from '../parts/places.ts';
import { lowerApplied, lowerNamed } from './access/names.ts';
import { lowerCall } from './calls.ts';
import { lowerLambda } from './closures.ts';
import {
  lowerArrayLiteral,
  lowerIndex,
  lowerMapLiteral,
  lowerRange,
} from './collections/collections.ts';
import { lowerComprehension, lowerFieldComprehension } from './collections/comprehensions.ts';
import { lowerAwait } from './control/await.ts';
import { lowerIf } from './control/control.ts';
import { lowerIs, lowerMatch } from './control/matching.ts';
import { lowerPropagate } from './control/propagate.ts';
import { lowerSelect } from './control/select.ts';
import { lowerDurationLiteral } from './literals/literals.ts';
import { lowerTuple, lowerTupleElement } from './literals/tuples.ts';
import { lowerBinary, lowerUnary } from './operators.ts';
import { lowerFieldRead, lowerFieldsLiteral, readsField } from './structs/structs.ts';

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const expressionHandlers: Handlers<FunctionContext, CoreExpression, [], Register> = {
  Identifier: lowerNamed,
  IntegerLiteral: (context, node) => context.constant(node.value, node.span),
  FloatLiteral: (context, node) => context.constant(node.value, node.span),
  StringLiteral: (context, node) => context.constant(node.value, node.span),
  BooleanLiteral: (context, node) => context.constant(node.value, node.span),
  Parenthesized: (context, node) => context.expression(node.expression),
  BlockExpression: (context, node) => context.block(node.block),
  Binary: lowerBinary,
  Unary: lowerUnary,
  Call: lowerCall,
  TypeApplication: lowerApplied,
  StructLiteral: lowerFieldsLiteral,
  NewStructLiteral: lowerFieldsLiteral,
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
 * `a.b`: a field read, or what a qualified member names, read as its name reads (access/names.ts):
 * a function named as a value through a namespace or its type, a variant, a namespace's constant.
 */
function lowerMemberAccess(context: FunctionContext, node: MemberAccess): Register {
  return readsField(context, node)
    ? lowerFieldRead(context, node)
    : lowerNamed(context, node.member, node);
}
