/**
 * Templates (§2).
 *
 * - An untagged template is a `string`. Each value is written as text by its `toString`, found as
 *   an operator's function is (resolution/implicit.ts), so a program's types, a type parameter's
 *   requirement and an `any Stringable` all take part; its texts and values are then joined by the
 *   prelude's `join`. A template without values is its text.
 * - A tagged template is the call it stands for (syntax/expressions/templates.ts), checked as any
 *   written call is, so the tag's parameters decide what its values must be.
 */

import { templateFunctions, wellKnown } from '../../../language/well-known.ts';
import type { Expression, TemplateLiteral } from '../../syntax/expressions/index.ts';
import { taggedCall } from '../../syntax/expressions/templates.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { topLevelCandidates } from '../resolution/candidates.ts';
import { implicitCall, preludeCandidates } from '../resolution/implicit.ts';
import { sameType, stringType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { wellKnownOf } from '../types/well-known.ts';

export function checkTemplate(
  context: BodyContext,
  node: TemplateLiteral,
  expected: Type | undefined,
): Type {
  if (node.tag !== undefined) {
    return context.expression(taggedCall(node, node.tag), expected);
  }
  for (const value of node.values) {
    interpolate(context, value);
  }
  if (node.values.length > 0) {
    const strings = wellKnownOf(context.checker, wellKnown.array, [stringType]);
    implicitCall(context, {
      node,
      role: 'join',
      candidates: preludeCandidates(context, templateFunctions.join),
      arguments: [
        { type: strings, passing: 'value' },
        { type: stringType, passing: 'value' },
      ],
      failure: () =>
        checkerDiagnostics.noMatchingOverload(node.span, 'join', 'Array<string>, string'),
    });
  }
  return stringType;
}

/** Checks `value` and makes the `toString` call that writes it as text. */
function interpolate(context: BodyContext, value: Expression): void {
  const type = context.expression(value);
  const failure = () => checkerDiagnostics.notStringable(value.span, typeText(type));
  const text = implicitCall(context, {
    node: value,
    role: 'interpolate',
    candidates: topLevelCandidates(context.checker, context.module, templateFunctions.toString, [
      type,
    ]),
    arguments: [{ type, passing: 'value' }],
    expected: stringType,
    failure,
  });
  if (text !== undefined && !sameType(text, stringType)) {
    context.report(failure());
  }
}
