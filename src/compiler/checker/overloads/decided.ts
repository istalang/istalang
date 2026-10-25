/**
 * Arguments whose type the chosen function decides (§3.5): such an argument has no type of its
 * own to choose by, so choosing asks which parameter types it can take (`CallArgument.accepts`),
 * and it is checked once its parameter is known (resolve.ts).
 *
 * Each construct contributes what it can take, beside its own rules: `none` and a bare variant
 * (expressions/variants.ts), a lambda with parameters to infer (closures/lambda-arguments.ts),
 * and functions named by a name of several or a generic one (closures/function-values.ts).
 */

import type { Expression } from '../../syntax/expressions.ts';
import { lastName } from '../../syntax/node.ts';
import { functionsAccepted, namedFunctions } from '../closures/function-values.ts';
import { lambdaAccepts } from '../closures/lambda-arguments.ts';
import type { BodyContext } from '../context.ts';
import { noneAccepted, variantsAccepted } from '../expressions/variants.ts';
import type { Type } from '../types/type.ts';

/**
 * When a call's chosen function decides the type of `node`, which parameter types it can take,
 * so choosing can rule out the rest; undefined for any other node, whose own type takes part in
 * choosing.
 */
export function decidedByCall(
  context: BodyContext,
  node: Expression,
): ((expected: Type) => boolean) | undefined {
  switch (node.kind) {
    case 'NoneLiteral':
      return noneAccepted(context);
    case 'Parenthesized':
      return decidedByCall(context, node.expression);
    case 'Lambda':
      return lambdaAccepts(node);
    case 'Identifier':
    case 'MemberAccess': {
      const functions = namedFunctions(context, node);
      if (functions !== undefined) {
        return functionsAccepted(context, functions);
      }
      return node.kind === 'Identifier'
        ? variantsAccepted(context, context.entityOf(node))
        : undefined;
    }
    case 'StructLiteral':
      return node.type === undefined
        ? undefined
        : variantsAccepted(context, context.entityOf(lastName(node.type.path)));
    default:
      return undefined;
  }
}
