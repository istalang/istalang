/**
 * Templates (§2).
 *
 * - An untagged template is a `String`. Each value is written as text by its `toString`, found as
 *   an operator's function is (resolution/applying/implicit.ts), so a program's types, a type
 *   parameter's requirement, an `any Stringable` and a union's trait (§6) all take part; its texts
 *   and values are then joined by the prelude's `join`. A template without values is its text.
 * - A value converts to what its `toString` takes, as an argument does, so a union of literals is
 *   written by its base's (§2).
 * - A tagged template is the call it stands for (syntax/expressions/literals/templates.ts), checked
 *   as any written call is, so the tag's parameters decide what its values must be.
 */

import { templateFunctions } from '../../../../language/well-known/implicit-calls.ts';
import type { TemplateLiteral } from '../../../syntax/expressions/index.ts';
import {
  constantTextOf,
  isTagged,
  taggedCall,
} from '../../../syntax/expressions/literals/templates.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { implicitCall, preludeCall } from '../../resolution/applying/implicit.ts';
import {
  type StoppingOperand,
  stoppedOperation,
} from '../../resolution/calls/stopped-operations.ts';
import { topLevelCandidates } from '../../resolution/choosing/candidates.ts';
import { sameType } from '../../types/identity/identity.ts';
import type { Type } from '../../types/type/index.ts';
import { stringType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type/type-text.ts';
import { arrayOf } from '../../types/type/well-known.ts';

export function checkTemplate(
  context: BodyContext,
  node: TemplateLiteral,
  expected: Type | undefined,
): Type {
  if (isTagged(node)) {
    return context.expression(taggedCall(node), expected);
  }
  const values = node.values.map((value) => ({ node: value, type: context.expression(value) }));
  const stopped = stoppedOperation(context, node, values);
  if (stopped !== undefined) {
    return stopped;
  }
  for (const value of values) {
    interpolate(context, value);
  }
  if (constantTextOf(node) === undefined) {
    join(context, node);
  }
  return stringType;
}

/** Makes the `join` call writing a template's texts and values as its string. */
function join(context: BodyContext, node: TemplateLiteral): void {
  preludeCall(context, {
    node,
    role: 'join',
    name: templateFunctions.join,
    arguments: [arrayOf(context.checker, stringType), stringType],
  });
}

/** Makes the `toString` call that writes `value`, of `type`, as text. */
function interpolate(context: BodyContext, { node: value, type }: StoppingOperand): void {
  const failure = () => checkerDiagnostics.notStringable(value.span, typeText(type));
  const text = implicitCall(context, {
    node: value,
    role: 'interpolate',
    candidates: topLevelCandidates(context.checker, context.module, templateFunctions.toString, [
      type,
    ]),
    arguments: [{ type, passing: 'value', node: value }],
    expected: stringType,
    failure,
  });
  if (text !== undefined && !sameType(text, stringType)) {
    context.report(failure());
  }
}
