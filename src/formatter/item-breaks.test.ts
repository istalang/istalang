/**
 * Formatting lists (proposal 5 §4, §6, notes 8, 10 and 11): a list on
 * one line separates items with ', ', while a list broken across lines puts one item per line with
 * no ',' at line ends; a 1-element tuple keeps its trailing ',' so it never becomes parenthesized;
 * statements keep ';'; and every formatted output reparses to the same tree and is a fixpoint.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dump } from '../compiler/syntax/tree.test-kit.ts';
import { commentTexts, parseText, unexplainedLongLines } from './format.test-kit.ts';
import { formatText, formatTree } from './format.ts';

const lines = (...text: readonly string[]): string => `${text.join('\n')}\n`;

function roundTripOf(text: string) {
  const tree = parseText(text);
  const formatted = formatTree(tree) ?? '';
  const reparsed = parseText(formatted);
  return {
    formatted,
    reparsed,
    actual: {
      diagnostics: reparsed.diagnostics,
      tree: dump(reparsed, reparsed.root),
      comments: commentTexts(reparsed),
      formattedAgain: formatTree(reparsed),
    },
    expected: {
      diagnostics: [],
      tree: dump(tree, tree.root),
      comments: commentTexts(tree),
      formattedAgain: formatted,
    },
  };
}

describe('lists on one line vs broken across lines (§4, §6)', () => {
  it('prints short field, constraint and mapped struct types on one line with ", "', () => {
    const text = lines(
      'type Item = { sku: String, qty: Int }',
      'type Mapped<S is struct { title: String, [_] is Sendable }> = { id: String, [F in keyof S]: S[F] }',
      'fn run(msg: String): { log(msg); save(msg) }',
    );
    expect(formatText(text)).toBe(text);
    const { actual, expected } = roundTripOf(text);
    expect(actual).toEqual(expected);
  });

  it('prints broken lists one item per line without trailing commas across all list kinds', () => {
    const longLists = lines(
      'const items = [',
      '  "first-long-element-in-the-array",',
      '  "second-long-element-in-the-array",',
      '  "third-long-element-in-the-array",',
      ']',
      'const mapping = [',
      '  "first-long-key": "first-long-value-in-the-map",',
      '  "second-long-key": "second-long-value-in-the-map",',
      '  "third-long-key": "third-long-value-in-the-map",',
      ']',
      'const literal = Response{',
      '  identifier: "response-identifier-string",',
      '  description: "response-description-string",',
      '  payload: "response-payload-string-value",',
      '}',
      'const result = computeSomethingLong(',
      '  "first-long-argument-to-call",',
      '  "second-long-argument-to-call",',
      '  namedOption: "third-long-argument-to-call",',
      ')',
    );
    const expectedFormatted = lines(
      'const items = [',
      '  "first-long-element-in-the-array"',
      '  "second-long-element-in-the-array"',
      '  "third-long-element-in-the-array"',
      ']',
      'const mapping = [',
      '  "first-long-key": "first-long-value-in-the-map"',
      '  "second-long-key": "second-long-value-in-the-map"',
      '  "third-long-key": "third-long-value-in-the-map"',
      ']',
      'const literal = Response{',
      '  identifier: "response-identifier-string"',
      '  description: "response-description-string"',
      '  payload: "response-payload-string-value"',
      '}',
      'const result = computeSomethingLong(',
      '  "first-long-argument-to-call"',
      '  "second-long-argument-to-call"',
      '  namedOption: "third-long-argument-to-call"',
      ')',
    );
    expect(formatText(longLists)).toBe(expectedFormatted);
    const { actual, expected } = roundTripOf(longLists);
    expect(actual).toEqual(expected);
  });

  it('breaks long parameter lists, type arguments, tuple types, and patterns without commas', () => {
    const input = lines(
      'fn processOrder<',
      '  FirstTypeParameter is Sendable & Encodable,',
      '  SecondTypeParameter is Sendable & Decodable,',
      '>(',
      '  firstParameter: FirstTypeParameter,',
      '  secondParameter: SecondTypeParameter,',
      '  thirdParameter: Map<FirstTypeParameter, SecondTypeParameter>,',
      ') -> (',
      '  FirstTypeParameter,',
      '  SecondTypeParameter,',
      '  Map<FirstTypeParameter, SecondTypeParameter>,',
      '):',
      '  (firstParameter, secondParameter, thirdParameter)',
    );
    const { formatted, actual, expected } = roundTripOf(input);
    expect(actual).toEqual(expected);
    expect(formatted).not.toContain(',\n');
  });

  it('preserves a 1-element tuple when broken across lines so it never reparses as parenthesized', () => {
    const oneTuple = lines(
      'const singleTuple = (',
      '  "a-very-long-single-tuple-element-that-exceeds-the-line-width-when-combined-with-its-binding-name",',
      ')',
    );
    const { actual, expected } = roundTripOf(oneTuple);
    expect(actual).toEqual(expected);
  });
});

describe('property: formatting generated short and broken lists reparses to the same tree (§6, note 11)', () => {
  const itemArb = fc.constantFrom(
    '1',
    '"short"',
    '"a-much-longer-string-element-forcing-line-breaks-in-brackets"',
    'Pair{first: 1, second: 2}',
    'compute(alpha, beta, gamma)',
    'a + b * c',
    '-1',
    '(1, "two")',
  );

  it('round-trips generated array, tuple, call and struct literal lists to the identical tree and fixpoint', () => {
    fc.assert(
      fc.property(
        fc.array(itemArb, { minLength: 1, maxLength: 6 }),
        fc.boolean(),
        (items, multiLine) => {
          const joiner = multiLine ? '\n  ' : ', ';
          const text = lines(
            `const arr = [${multiLine ? `\n  ${items.join(joiner)}\n` : items.join(joiner)}]`,
            `const call = invoke(${multiLine ? `\n  ${items.join(joiner)}\n` : items.join(joiner)})`,
          );
          const { actual, expected, reparsed } = roundTripOf(text);
          expect(actual).toEqual(expected);
          expect(unexplainedLongLines(reparsed)).toEqual([]);
        },
      ),
      { numRuns: 50 },
    );
  });
});
