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
import { languageModules } from '../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Call } from '../../syntax/expressions/calls.ts';
import type {
  ArrayLiteral,
  Expression,
  MemberAccess,
  TemplateLiteral,
} from '../../syntax/expressions/index.ts';
import type { StringLiteral } from '../../syntax/expressions/literals/literals.ts';
import { constantTextOf } from '../../syntax/expressions/literals/templates.ts';
import { endOf, spanAcross } from '../../syntax/tree/positions.ts';
import type { BodyContext } from '../contexts/body-context.ts';
import { bound, type Origin, synthesized } from '../contexts/synthesized.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { CoreExpression } from '../surface/checked-body.ts';
import { typeText } from '../types/type/type-text.ts';
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
    const { tag } = node;
    if (tag !== undefined) {
      return tagged(node, tag);
    }
    const text = constantTextOf(node);
    if (text !== undefined) {
      const literal = { kind: 'StringLiteral', span: node.span, value: text } as const;
      return synthesized({ sugar: node, role: 'text' }, literal satisfies StringLiteral);
    }
    return joined(context, node);
  },
  wording: {
    [checkerDiagnostics.noMatchingOverload.code]: notWritten,
    [checkerDiagnostics.insideOptional.code]: notWritten,
    [checkerDiagnostics.typeMismatch.code]: notWritten,
  },
};

/** `tag(texts, values…)`, the call a tagged template makes. */
function tagged(node: TemplateLiteral, tag: Expression): Call {
  const origin = { sugar: node, role: 'tagged' };
  const texts: ArrayLiteral = {
    kind: 'ArrayLiteral',
    span: spanAcross(endOf(tag.span), node.span),
    elements: node.texts.map(({ span, value }) => textOf(origin, span, value)),
  };
  return synthesized(origin, {
    kind: 'Call',
    span: node.span,
    callee: tag,
    isOptional: false,
    arguments: [synthesized(origin, texts), ...node.values],
  });
}

/** `join([…], "")` of `node`'s texts, the empty ones left out, and its values written as text. */
function joined(context: BodyContext, node: TemplateLiteral): CoreExpression {
  const origin = { sugar: node, role: 'joined' };
  const parts = node.texts.flatMap(({ span, value }, index) => {
    const text = value === '' ? [] : [textOf(origin, span, value)];
    const written = node.values[index];
    return written === undefined ? text : [...text, writtenAsText(node, written)];
  });
  const prelude = { module: languageModules.prelude, name: templateFunctions.join };
  const join =
    context.checker.wellKnownEntity(prelude) ?? unreachable("The prelude declares 'join'.");
  const callee = { kind: 'Identifier', span: node.span, text: templateFunctions.join } as const;
  const array = { kind: 'ArrayLiteral', span: node.span, elements: parts } as const;
  return synthesized(origin, {
    kind: 'Call',
    span: node.span,
    callee: bound(synthesized(origin, callee), join),
    isOptional: false,
    arguments: [synthesized(origin, array), textOf(origin, endOf(node.span), '')],
  } satisfies Call);
}

/** `(value).toString()`, at `value`; the parentheses end any chain `value` is. */
function writtenAsText(node: TemplateLiteral, value: Expression): Call {
  const origin = { sugar: node, role: 'interpolate' };
  const { span } = value;
  const target = { kind: 'Parenthesized', span, expression: value } as const;
  const member = { kind: 'Identifier', span, text: templateFunctions.toString } as const;
  const access: MemberAccess = {
    kind: 'MemberAccess',
    span,
    target: synthesized(origin, target),
    isOptional: false,
    member: synthesized(origin, member),
  };
  return synthesized(origin, {
    kind: 'Call',
    span,
    callee: synthesized(origin, access),
    isOptional: false,
    arguments: [],
  });
}

function textOf(origin: Origin, span: StringLiteral['span'], value: string): StringLiteral {
  return synthesized(origin, { kind: 'StringLiteral', span, value });
}

/** The value of `template` written at `span`. */
function valueAt(template: TemplateLiteral, span: StringLiteral['span']): Expression | undefined {
  return template.values.find(
    (value) => value.span.from === span.from && value.span.to === span.to,
  );
}
