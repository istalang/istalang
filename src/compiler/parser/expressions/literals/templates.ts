/**
 * Templates (§2): `` `a ${x} b` ``, and `` tag`…` `` calling `tag` with the texts and the values.
 *
 * The scanner keeps each value's tokens in the template token (syntax/tokens.ts), so each value is
 * parsed from those, as a bracketed expression: an error inside one ends at its `}`, and nothing
 * outside the template is read. A tag attaches the way a call's `(` does, at the postfix level.
 */

import type { Expression } from '../../../syntax/expressions/index.ts';
import type { TemplateValue } from '../../../syntax/tokens.ts';
import { skipUntil } from '../../cursor/recovery.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import type { Parser } from '../../parser.ts';
import type { InfixParselet } from '../parselet.ts';

/** An untagged template. */
export function parseTemplate(parser: Parser): Expression {
  return templateLiteral(parser, undefined);
}

/** A template right after an expression: the expression is its tag. */
export const templateParselet: InfixParselet = {
  level: 'postfix',
  parse: (parser, tag) => templateLiteral(parser, tag),
};

function templateLiteral(parser: Parser, tag: Expression | undefined): Expression {
  const token = parser.cursor.advance();
  if (token.kind !== 'template') {
    return parser.missing('a template');
  }
  const texts = token.texts.map(
    ({ span, value }) => ({ kind: 'TemplateText', span: parser.anchor(span), value }) as const,
  );
  const values = token.values.map((value) => parseValue(parser, value));
  const start = tag === undefined ? token.span.start : parser.startOf(tag);
  return { kind: 'TemplateLiteral', span: parser.spanFrom(start), tag, texts, values };
}

/** The expression of one `${…}`; an empty one is reported, and anything after the expression. */
function parseValue(parser: Parser, value: TemplateValue): Expression {
  return parser.withinTemplateValue(value, () => {
    if (parser.cursor.at('end')) {
      parser.report(parserDiagnostics.emptyTemplateValue(value.span));
      return parser.placeholder();
    }
    const expression = parser.expression();
    if (!parser.cursor.at('end')) {
      parser.reportExpected("'}'");
      skipUntil(parser, []);
    }
    return expression;
  });
}
