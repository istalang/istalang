/**
 * What a tagged template stands for (§2): `` tag`a ${x} b` `` is the call `tag(["a ", " b"], x)`.
 *
 * The tree keeps the template as written, for tools. The checker and lowering read the call derived
 * here instead, so a tag is called exactly as a written call is, whatever its form (a function, a
 * method, a function value). It is one node per template, memoized, so whatever one phase records
 * for the call, the next finds again.
 */

import { memo } from '../../../structures/memo.ts';
import type { ArrayLiteral, Call, Expression, TemplateLiteral } from './index.ts';

const calls = new WeakMap<TemplateLiteral, Call>();

/** The call `template` makes of its tag: its texts as an array of strings, then each value. */
export function taggedCall(template: TemplateLiteral, tag: Expression): Call {
  return memo(calls, template, () => {
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
