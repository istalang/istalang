/**
 * How a field loop's passes join each fact of a body, for tools reading a node inside the loop
 * (§4, lookup/pass-views.ts); each fact's entry in the table (index.ts) names its join.
 *
 * - A type joins every pass's: a key is each field's name, a value each field's type. Tools show
 *   what the text means across the loop, as a hover over the loop's value shows the union of its
 *   fields' types.
 * - A call, and a lambda as checked, lists every pass's distinct one: `show(v)` calls `show(Int)`
 *   in one pass and `show(String)` in another, and the text means both, but two calls don't join
 *   into one as types do.
 * - Anything else, a pattern, a field read, is the first pass's that has one: each pass checked
 *   the same text, and what differs between them is their types.
 */

import type { PassAnswers } from '../../lookup/pass-views.ts';
import type { PassRecords } from '../../passes.ts';
import type { Type } from '../../types/type/index.ts';
import type { TypeRules } from '../../types/type-rules.ts';
import { unionOf } from '../../types/unions/unions.ts';

/**
 * A type by node: every pass's that has one, joined into their union; one body's own, as written,
 * where only one is read.
 */
export function typesJoined<Args extends unknown[]>(
  answers: PassAnswers<(...args: Args) => Type | undefined>,
  rules: TypeRules,
): (...args: Args) => Type | undefined {
  const [only, ...others] = answers;
  if (others.length === 0) {
    return only;
  }
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

/** A list by node: every pass's items, each once, in the order checked. */
export function everyListed<Args extends unknown[], Item>(
  answers: PassAnswers<(...args: Args) => readonly Item[]>,
): (...args: Args) => readonly Item[] {
  return (...args) => [...new Set(answers.flatMap((answer) => answer(...args)))];
}

/** An answer by node every pass may give another of: each pass's, once each by `same`, in order. */
export function everyDistinct<Args extends unknown[], Value>(
  answers: readonly ((...args: Args) => Value | undefined)[],
  same: (one: Value, other: Value) => boolean,
): (...args: Args) => readonly Value[] {
  return (...args) =>
    answers
      .flatMap((answer) => answer(...args) ?? [])
      .filter((value, index, all) => all.findIndex((other) => same(value, other)) === index);
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

/** An answer every pass gives, by node or of the body whole: the first pass's. */
export function firstPass<Answer>(answers: PassAnswers<Answer>): Answer {
  return answers[0];
}
