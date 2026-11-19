/**
 * What a template stands for (§3.1), read off the syntax: a template without values or a tag is its
 * text, as a string literal is, so compile time computes it. Every template is sugar for the core
 * expression it means (checker/desugaring/templates.ts), so no other phase reads one.
 */

import type { TemplateLiteral } from '../index.ts';

/** The text `template` is when it has no values or tag; undefined otherwise. */
export function constantTextOf(template: TemplateLiteral): string | undefined {
  return template.tag === undefined && template.values.length === 0
    ? (template.texts[0]?.value ?? '')
    : undefined;
}
