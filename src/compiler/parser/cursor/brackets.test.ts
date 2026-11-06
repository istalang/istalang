/**
 * Bracket pairing as properties over generated layouts: brackets that all pair are read by bracket
 * alone, whatever their indentation, and any soup pairs into well-formed groups, each bracket left
 * open ending after its opener. Where an indentation decides is shown by recovery.test.ts, through
 * the trees the parser builds.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lineMapOf } from '../../../text/line-map.ts';
import { createSourceText } from '../../../text/source-text.ts';
import { scan } from '../../scanner/scan.ts';
import type { Token } from '../../syntax/tokens/index.ts';
import { type BracketPairs, bracketClosers, pairBrackets } from './brackets.ts';

/** Words standing between brackets, each on a line of its own or after a space. */
const separator = fc.oneof(
  fc.constant(' '),
  fc.nat(6).map((indentation) => `\n${' '.repeat(indentation)}`),
);

interface Group {
  readonly opener: '(' | '[' | '{';
  readonly items: readonly (Group | 'a')[];
}

const balanced = fc.letrec<{ group: Group; item: Group | 'a' }>((tie) => ({
  group: fc.record({
    opener: fc.constantFrom('(' as const, '[' as const, '{' as const),
    items: fc.array(tie('item'), { maxLength: 4 }),
  }),
  item: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constant('a' as const),
    tie('group'),
  ),
})).group;

function words(group: Group): readonly string[] {
  const closer = bracketClosers.get(group.opener) ?? ')';
  return [
    group.opener,
    ...group.items.flatMap((item) => (item === 'a' ? ['a'] : words(item))),
    closer,
  ];
}

const soup = fc.array(fc.constantFrom('(', ')', '[', ']', '{', '}', 'a'), { maxLength: 30 });

/** `source`'s words laid out with `separators`, scanned, with each token's column. */
function laidOut(source: readonly string[], separators: readonly string[]) {
  return scanned(source.map((word, index) => `${separators[index] ?? ' '}${word}`).join(''));
}

/** `text` scanned, with each token's column. */
function scanned(text: string): { tokens: readonly Token[]; columnOf: (token: Token) => number } {
  const sourceText = createSourceText('test.ista', text);
  const lineMap = lineMapOf(sourceText);
  return {
    tokens: scan(sourceText).tokens,
    columnOf: (token) => lineMap.positionAt(token.span.start).column,
  };
}

/** The partner of each bracket a stack pairs, for brackets that all pair. */
function stackPairs(tokens: readonly Token[]): ReadonlyMap<number, number> {
  const open: number[] = [];
  const pairs = new Map<number, number>();
  tokens.forEach(({ kind }, index) => {
    if (bracketClosers.has(kind)) {
      open.push(index);
    } else if (kind === ')' || kind === ']' || kind === '}') {
      const opener = open.pop() ?? -1;
      pairs.set(opener, index).set(index, opener);
    }
  });
  return pairs;
}

/** Lists of words, each with a separator before each word. */
const layouts = (wordLists: fc.Arbitrary<readonly string[]>) =>
  wordLists.chain((source) =>
    fc.tuple(
      fc.constant(source),
      fc.array(separator, { minLength: source.length, maxLength: source.length }),
    ),
  );

describe('pairing brackets', () => {
  it('reads brackets that all pair by bracket alone, whatever their indentation', () => {
    fc.assert(
      fc.property(layouts(balanced.map(words)), ([source, separators]) => {
        const { tokens, columnOf } = laidOut(source, separators);
        const { partnerOf, unclosedEnds } = pairBrackets(tokens, columnOf);
        const pairs = stackPairs(tokens);
        expect(tokens.map((_, index) => partnerOf(index))).toEqual(
          tokens.map((_, index) => pairs.get(index)),
        );
        expect(unclosedEnds.size).toBe(0);
      }),
      { numRuns: 300 },
    );
  });

  it.each([
    ['nested calls', 'fn f():\n  h(\n    g([\n      k(1,\n    )\n  )'],
    [
      'groups re-paired one inside another',
      'fn f():\n  h(\n    [\n      [1,\n    ],\n    g(2,\n  )',
    ],
    ['a shrunk soup', '  { (\n    {\n} {'],
  ])('ends a bracket left open inside a re-paired group by its closer: %s', (_, text) => {
    const { tokens, columnOf } = scanned(text);
    expect(malformed(tokens, pairBrackets(tokens, columnOf))).toEqual([]);
  });

  it('pairs any soup into nested groups of one kind, a bracket left open ending inside its group', () => {
    fc.assert(
      fc.property(layouts(soup), ([source, separators]) => {
        const { tokens, columnOf } = laidOut(source, separators);
        expect(malformed(tokens, pairBrackets(tokens, columnOf))).toEqual([]);
      }),
      { numRuns: 500 },
    );
  });
});

/**
 * How `pairs` breaks the shape of a pairing, as `"<index> <what>"`: partners that don't agree,
 * differ in kind or cross, or a bracket left open that doesn't end after its opener and by the
 * closer of the group around it.
 */
function malformed(tokens: readonly Token[], pairs: BracketPairs): string[] {
  const open: number[] = [];
  return tokens.flatMap(({ kind }, index) => {
    const partner = pairs.partnerOf(index);
    if (partner === undefined) {
      const bound = open.at(-1) ?? tokens.length - 1;
      return endsWithin(pairs, kind, index, bound) ? [] : [`${index} left open, not ended within`];
    }
    if (!agrees(pairs, index, partner)) {
      return [`${index} partners disagree, or a paired bracket is also left open`];
    }
    if (partner > index) {
      open.push(partner);
      return bracketClosers.get(kind) === tokens[partner]?.kind ? [] : [`${index} kinds differ`];
    }
    return open.pop() === index ? [] : [`${index} crosses a group`];
  });
}

/** Whether `index` and `partner` pair each other, and neither is left open as well. */
function agrees(
  { partnerOf, unclosedEnds }: BracketPairs,
  index: number,
  partner: number,
): boolean {
  return partnerOf(partner) === index && !unclosedEnds.has(index);
}

/**
 * Whether a token of `kind` at `index` paired with nothing, if an opener, ends after itself and by
 * `bound`, the closer of the group around it.
 */
function endsWithin(
  { unclosedEnds }: BracketPairs,
  kind: string,
  index: number,
  bound: number,
): boolean {
  const end = unclosedEnds.get(index) ?? index;
  return !bracketClosers.has(kind) || (end > index && end <= bound);
}
