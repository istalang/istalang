/**
 * `strings.format`'s templates (§3.8): `{}` takes the next value, `{n}` value `n`, and `{{` and
 * `}}` write a brace. The template is the program's own text, so a placeholder without a value, or
 * a brace that is neither, is a bug in it and panics (§3.12). `{}` counts on from the last `{}`
 * alone, so writing `{n}` between them doesn't move it; values no placeholder takes are left out.
 */

import { Panic } from '../../runtime/natives.ts';

/** Every token of a template: an escaped brace, a placeholder, or a stray brace. */
const tokens = /\{\{|\}\}|\{(?<position>\d*)\}|[{}]/gu;

/** `template` with its placeholders replaced by `values`. */
export function formatted(template: string, values: readonly string[]): string {
  let next = 0;
  return template.replace(tokens, (token, digits: string | undefined) => {
    if (token === '{{' || token === '}}') {
      return token[0] ?? '';
    }
    if (digits === undefined) {
      throw new Panic(
        `The template '${template}' has a stray '${token}'; '${token}${token}' writes one.`,
      );
    }
    const position = digits === '' ? next : Number(digits);
    next += digits === '' ? 1 : 0;
    const value = values[position];
    if (value === undefined) {
      throw new Panic(
        `The template '${template}' has no value for placeholder ${position}: it was given ${values.length}.`,
      );
    }
    return value;
  });
}
