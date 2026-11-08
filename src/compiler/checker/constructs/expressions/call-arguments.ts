/**
 * A call's arguments as written, as choosing takes them (§3.3, §3.5): each checked now, in the
 * call's constraint scope (contexts/constraint-scope.ts), or left for the chosen function to
 * decide.
 */

import type { CallArgument, Expression, Spread } from '../../../syntax/expressions/index.ts';
import { unparenthesized } from '../../../syntax/expressions/readings.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { joinsScope } from '../../contexts/constraint-scope.ts';
import { checkChangedPlace } from '../../resolution/calls/places.ts';
import type { WrittenArgument } from '../../resolution/calls/resolve.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';
import { arrayElement } from '../../types/type/well-known.ts';
import { writtenLiteral } from '../../types/unions/unions.ts';
import { writtenInputs } from '../closures/lambdas.ts';
import { spreadArgumentType } from './collections/collections.ts';

/**
 * An argument as written: `&x` passes the place `x`, checked as a place that may change; a spread,
 * its items, as an array literal's spread gives them (§2), or a pack's value, as it is (§3.5); any
 * other is a value, checked now unless the chosen function decides its type, a literal with its
 * literal type beside, which it has where its parameter expects one (§2), and a literal of items
 * read once those whose types only checking tells are checked (`argumentPart`). A named argument
 * is its value, named. One whose parameter's type is known before choosing, `known` (a function
 * value's, value-calls.ts; a spread's items' type), is checked against it.
 */
export function writtenArgument(
  context: BodyContext,
  argument: CallArgument,
  known: Type | undefined,
): WrittenArgument {
  switch (argument.kind) {
    case 'Spread':
      return spreadArgument(context, argument, known);
    case 'NamedArgument':
      return { ...valueArgument(context, argument.value, known), name: argument.name };
    default:
      return valueArgument(context, argument, known);
  }
}

/**
 * A spread argument: its items, which fit the rest parameter's element exactly. An array literal
 * spread joins the call's scope (design.md §4), its items its element, copied whole as built.
 */
function spreadArgument(
  context: BodyContext,
  argument: Spread,
  known: Type | undefined,
): WrittenArgument {
  const { expression } = argument;
  const joined =
    known === undefined && expression.kind === 'ArrayLiteral' && joinsScope(expression)
      ? context.expression(expression)
      : undefined;
  const items = joined === undefined ? undefined : arrayElement(context.checker, joined);
  if (items === undefined) {
    const type = spreadArgumentType(context, argument, known);
    return { node: expression, passing: 'value', type, isSpread: true };
  }
  context.iterations.record(argument, { kind: 'copied' });
  return { node: expression, passing: 'value', type: items, isSpread: true };
}

function valueArgument(
  context: BodyContext,
  argument: Expression,
  known: Type | undefined,
): WrittenArgument {
  if (argument.kind === 'Reference') {
    const type = checkChangedPlace(context, argument.expression, 'referenced');
    return { node: argument, passing: 'reference', type };
  }
  const literal = writtenLiteral(unparenthesized(argument));
  if (known !== undefined) {
    const type = context.expression(argument, known);
    // Reported here, as a literal's field is, so an argument beside one in error is still judged;
    // it then counts as the error type, so the call reports nothing more of it. One still open in
    // the call's scope is matched by the call, as any argument is.
    if (
      !context.scopes.holds(type) &&
      type.kind !== 'error' &&
      context.checker.fitOf(type, known) === undefined
    ) {
      context.fit(type, known, argument);
      return { node: argument, passing: 'value', type: errorType, literal };
    }
    return { node: argument, passing: 'value', type, literal };
  }
  const part = context.argumentPart(argument);
  // `none` passed alone is `None`, a type like any other the call's inference joins (§3.5); inside
  // a composite it still waits for the call, as its siblings decide where it goes. A `struct{…}`'s
  // shape only bounds what the call gives it.
  if (part.kind === 'decided' && (part.alone === undefined || part.known !== undefined)) {
    const lambda = unparenthesized(argument);
    const bound =
      part.known ?? (lambda.kind === 'Lambda' ? writtenInputs(context, lambda) : undefined);
    return {
      node: argument,
      passing: 'value',
      type: undefined,
      literal,
      accepts: part.accepts,
      known: bound,
    };
  }
  const type = context.expression(argument);
  return { node: argument, passing: 'value', type, literal };
}
