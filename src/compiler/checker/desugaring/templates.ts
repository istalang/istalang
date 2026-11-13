/**
 * Templates (§2), each the core expression it stands for:
 *
 * - `` tag`a ${x} b` `` is the call `tag(["a ", " b"], x)`, an ordinary call, so `tag` is any
 *   function, method or function value, and its parameters decide what the values must be.
 * - A template without values or a tag is its text, a String literal.
 * - Any other is `join([texts and values, in order], "")`, each value written as text by
 *   `(value).toString()`, found as a method is: among the functions its top level sees and those
 *   its type's module, a type parameter's requirement, an `any Stringable` and a union's trait
 *   bring (§3.10, §6). An empty text is left out. `join` is the prelude's, whatever a local name
 *   shadows (§3.4).
 * - A value with no `toString` giving a String is worded as the template's mistake, at the value.
 */

import { templateFunctions } from '../../../foundation/language/well-known/implicit-calls.ts';
import type { Call } from '../../syntax/expressions/calls.ts';
import type { Expression, TemplateLiteral } from '../../syntax/expressions/index.ts';
import type { StringLiteral } from '../../syntax/expressions/literals/literals.ts';
import { constantTextOf } from '../../syntax/expressions/literals/templates.ts';
import { endOf, spanAcross } from '../../syntax/tree/positions.ts';
import type { BodyContext } from '../contexts/body-context.ts';
import { synthesized } from '../contexts/synthesized.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { typeText } from '../types/type/type-text.ts';
import { callOf, preludeName, stringOf } from './core-nodes.ts';
import type { Desugar, Reword } from './index.ts';

/** How a value's text is worded when no `toString` writes it. */
const notWritten: Reword<TemplateLiteral> = (context, diagnostic, { sugar, role }) => {
  const value = role === 'tagged' ? undefined : valueAt(sugar, diagnostic.span);
  return value === undefined
    ? diagnostic
    : checkerDiagnostics.notStringable(value.span, typeText(context.typeOf(value)));
};

export const templates: Desugar<TemplateLiteral> = {
  core: (context, node) => {
    const { tag, span } = node;
    if (tag !== undefined) {
      const origin = { sugar: node, role: 'tagged' };
      const texts = node.texts.map((each) => stringOf(origin, each.span, each.value));
      const array = {
        kind: 'ArrayLiteral',
        span: spanAcross(endOf(tag.span), span),
        elements: texts,
      } as const;
      return callOf(origin, span, tag, [synthesized(origin, array), ...node.values]);
    }
    const text = constantTextOf(node);
    return text === undefined
      ? joined(context, node)
      : stringOf({ sugar: node, role: 'text' }, span, text);
  },
  wording: {
    [checkerDiagnostics.noMatchingOverload.code]: notWritten,
    [checkerDiagnostics.insideOptional.code]: notWritten,
    [checkerDiagnostics.typeMismatch.code]: notWritten,
  },
};

/** `join([…], "")` of `node`'s texts, the empty ones left out, and its values written as text. */
function joined(context: BodyContext, node: TemplateLiteral): Call {
  const origin = { sugar: node, role: 'joined' };
  const { span } = node;
  const parts = node.texts.flatMap((text, index) => {
    const written = text.value === '' ? [] : [stringOf(origin, text.span, text.value)];
    const value = node.values[index];
    return value === undefined ? written : [...written, writtenAsText(node, value)];
  });
  const array = synthesized(origin, { kind: 'ArrayLiteral', span, elements: parts } as const);
  const join = preludeName(context, origin, templateFunctions.join, span);
  return callOf(origin, span, join, [array, stringOf(origin, endOf(span), '')]);
}

/** `(value).toString()`, at `value`; the parentheses end any chain `value` is. */
function writtenAsText(node: TemplateLiteral, value: Expression): Call {
  const origin = { sugar: node, role: 'interpolate' };
  const { span } = value;
  const target = synthesized(origin, { kind: 'Parenthesized', span, expression: value } as const);
  const name = { kind: 'Identifier', span, text: templateFunctions.toString } as const;
  const access = {
    kind: 'MemberAccess',
    span,
    target,
    isOptional: false,
    member: synthesized(origin, name),
  } as const;
  return callOf(origin, span, synthesized(origin, access), []);
}

/** The value of `template` written at `span`. */
function valueAt(template: TemplateLiteral, span: StringLiteral['span']): Expression | undefined {
  return template.values.find(
    (value) => value.span.from === span.from && value.span.to === span.to,
  );
}
