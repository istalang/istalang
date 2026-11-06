/**
 * A field loop's passes read as one body, for tools asking about a node inside it (§4): the body
 * is checked once per field it visits (passes.ts), but a position in the text is one node. Each
 * fact of a body names how its passes' answers join (body-facts.ts), from the joins below:
 *
 * - A type joins every pass's: a key is each field's name, a value each field's type. Tools show
 *   what the text means across the loop, as a hover over the loop's value shows the union of its
 *   fields' types.
 * - Anything else, a call, a pattern, a field read, is the first pass's that has one: each pass
 *   checked the same text, and what differs between them is their types.
 * - A loop with no pass, over a struct with no fields, checked nothing, so its nodes answer
 *   nothing.
 */

import { isOverFields, passedParts } from '../../syntax/statements.ts';
import type { SyntaxNode } from '../../syntax/tree.ts';
import type { CheckedBody } from '../check.ts';
import type { PassRecords } from '../passes.ts';
import type { Type } from '../types/type.ts';
import type { TypeRules } from '../types/type-rules.ts';
import { unionOf } from '../types/unions.ts';

/** One answer per pass of a field loop, in the order checked: there is one at least. */
export type PassAnswers<Answer> = readonly [Answer, ...Answer[]];

/**
 * `body` as tools read it at `node`, below each construct over fields on `path` (from `node`
 * outward) whose header binds or whose passed parts hold `node`: each one's passes, joined.
 */
export function passesAround(
  body: CheckedBody,
  path: readonly SyntaxNode[],
  rules: TypeRules,
): CheckedBody {
  const outward = path.toReversed();
  return outward.reduce((outer, each, index) => {
    if (!isOverFields(each)) {
      return outer;
    }
    const child = outward[index + 1];
    const part = child === each.header ? outward[index + 2] : undefined;
    const passed =
      passedParts(each).some((passedPart) => passedPart === child) ||
      part === each.header.key ||
      part === each.header.value;
    return passed ? outer.passesJoined(each.header, rules) : outer;
  }, body);
}

/** A type by node: every pass's that has one, joined into their union. */
export function typesJoined<Args extends unknown[]>(
  answers: PassAnswers<(...args: Args) => Type | undefined>,
  rules: TypeRules,
): (...args: Args) => Type | undefined {
  return (...args) => {
    const types = answers.flatMap((answer) => answer(...args) ?? []);
    return types.length === 0 ? undefined : unionOf(types, rules);
  };
}

/** An answer by node: the first pass's that has one. */
export function firstFound<Args extends unknown[], Value>(
  answers: PassAnswers<(...args: Args) => Value | undefined>,
): (...args: Args) => Value | undefined {
  return (...args): Value | undefined => {
    for (const answer of answers) {
      const value = answer(...args);
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  };
}

/** A list by node: the first pass's that isn't empty. */
export function firstListed<Args extends unknown[], Item>(
  answers: PassAnswers<(...args: Args) => readonly Item[]>,
): (...args: Args) => readonly Item[] {
  return (...args) =>
    answers.map((answer) => answer(...args)).find((each) => each.length > 0) ?? [];
}

/** A list by node: every pass's, in the order checked. */
export function everyListed<Args extends unknown[], Item>(
  answers: PassAnswers<(...args: Args) => readonly Item[]>,
): (...args: Args) => readonly Item[] {
  return (...args) => answers.flatMap((answer) => answer(...args));
}

/** Whether a node holds in every pass, as a branch is ruled out only where every pass rules it out. */
export function inEveryPass<Args extends unknown[]>(
  answers: PassAnswers<(...args: Args) => boolean>,
): (...args: Args) => boolean {
  return (...args) => answers.every((answer) => answer(...args));
}

/** Records by node: the first pass's that has one, and held where any pass has one. */
export function firstRecorded<Key, Value>(
  answers: PassAnswers<PassRecords<Key, Value>>,
): PassRecords<Key, Value> {
  return {
    get: (key) => answers.map((answer) => answer.get(key)).find((value) => value !== undefined),
    has: (key) => answers.some((answer) => answer.has(key)),
  };
}

/** What every pass answers alike, the body's own and not its nodes': the first pass's. */
export function firstPass<Answer>(answers: PassAnswers<Answer>): Answer {
  return answers[0];
}
