/**
 * What a template stands for (§2), decided once for every phase that reads one.
 *
 * - A template without values or a tag is its text, as a string literal is: the checker makes no
 *   call for it, compile time computes it, and lowering writes it as a constant.
 * - `` tag`a ${x} b` `` is the call `tag(["a ", " b"], x)`. The tree keeps the template as written,
 *   for tools; the checker and lowering read the call derived here instead, so a tag is called
 *   exactly as a written call is, whatever its form (a function, a method, a function value). It is
 *   one node per template, memoized, so whatever one phase records for the call, the next finds.
 */

import { memo } from '../../../structures/memo.ts';
import type { ArrayLiteral, Call, Expression, TemplateLiteral } from './index.ts';

/** A template with a tag. */
export type TaggedTemplate = TemplateLiteral & { readonly tag: Expression };

export function isTagged(template: TemplateLiteral): template is TaggedTemplate {
  return template.tag !== undefined;
}

/** The text `template` is when it has no values or tag; undefined otherwise. */
export function constantTextOf(template: TemplateLiteral): string | undefined {
  return template.tag === undefined && template.values.length === 0
    ? (template.texts[0]?.value ?? '')
    : undefined;
}

const calls = new WeakMap<TaggedTemplate, Call>();

/** The call `template` makes of its tag: its texts as an array of strings, then each value. */
export function taggedCall(template: TaggedTemplate): Call {
  return memo(calls, template, () => {
    const { tag } = template;
    const texts: ArrayLiteral = {
      kind: 'ArrayLiteral',
      span: { start: tag.span.end, end: template.span.end },
      elements: template.texts.map(({ span, value }) => ({ kind: 'StringLiteral', span, value })),
    };
    return {
      kind: 'Call',
      span: template.span,
      callee: tag,
      isOptional: false,
      typeArguments: [],
      arguments: [texts, ...template.values],
    };
  });
}
