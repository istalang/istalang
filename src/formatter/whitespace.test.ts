/**
 * Whitespace where a line break means nothing, inside `()`, `[]`, `${}` and a struct literal's
 * `{}`, changes nothing the formatter prints (formatter.md, Acceptance 5).
 *
 * Some gaps there are left alone, each for a reason of its own:
 * - a gap holding a comment: a line break before it would make an end-of-line comment own-line;
 * - a gap on the line a multi-line literal starts on: its copy moves with that line's indentation;
 * - inside `${}`, line breaks: they would make a single-line template a multi-line one, which is
 *   copied as written.
 * A variant whose tree changed is no variant of the input (an indented block nested in brackets
 * minds its columns), so it is skipped.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scan } from '../compiler/scanner/scan.ts';
import type { Token } from '../compiler/syntax/tokens/index.ts';
import { extentIn, nodesUnder, type SyntaxNode } from '../compiler/syntax/tree/index.ts';
import { dump } from '../compiler/syntax/tree/tree.test-kit.ts';
import { encloses, type Span } from '../foundation/text/span.ts';
import { commentTexts, formattableInputs, parseText } from './format.test-kit.ts';
import { formatTree } from './format.ts';
import { nodesInBrackets } from './layout/brackets.ts';

interface Gap {
  readonly offset: number;
  readonly spacesOnly: boolean;
}

const lineBreak = /[\r\n]/u;

function gapsBetween(tokens: readonly Token[], spacesOnly: boolean): readonly (Gap & Span)[] {
  return tokens.slice(1).map((token, index) => ({
    start: tokens[index]?.span.end ?? token.span.start,
    end: token.span.start,
    offset: tokens[index]?.span.end ?? token.span.start,
    spacesOnly,
  }));
}

/** The gaps of `text` where whitespace may be added without changing what it says. */
function freeGaps(text: string): readonly Gap[] {
  const tree = parseText(text);
  const { tokens } = scan(tree.source);
  const inBrackets = nodesInBrackets(tree);
  const nodes = nodesUnder(tree, tree.root);
  const isFree = (node: SyntaxNode | undefined): boolean =>
    node !== undefined && inBrackets.has(node);
  const deepestAt = (offset: number, edge: 'start' | 'end'): SyntaxNode | undefined =>
    nodes.findLast((node) => extentIn(tree, node)[edge] === offset);
  const multiLineStarts = tokens
    .filter((token) => token.kind === 'template' || token.kind === 'docstring')
    .filter((token) => lineBreak.test(text.slice(token.span.start, token.span.end)))
    .map((token) => token.span.start);
  const templateGaps = tokens.flatMap((token) =>
    token.kind === 'template' && !multiLineStarts.includes(token.span.start)
      ? token.values.flatMap((value) => gapsBetween(value.tokens, true))
      : [],
  );
  const bracketGaps = gapsBetween(
    tokens.filter((token) => token.kind !== 'end'),
    false,
  ).filter((gap) => isFree(deepestAt(gap.end, 'start')) || isFree(deepestAt(gap.start, 'end')));
  return [...bracketGaps, ...templateGaps].filter(
    (gap) =>
      !(
        text.slice(gap.start, gap.end).includes('#') ||
        tree.comments.some((comment) => encloses(gap, comment.span)) ||
        multiLineStarts.some(
          (start) => start >= gap.end && !lineBreak.test(text.slice(gap.end, start)),
        )
      ),
  );
}

const inputs = formattableInputs
  .map(({ name, text }) => ({ name, text, gaps: freeGaps(text) }))
  .filter(({ gaps }) => gaps.length > 0);

const whitespace = (spacesOnly: boolean): fc.Arbitrary<string> =>
  spacesOnly
    ? fc.integer({ min: 1, max: 3 }).map((count) => ' '.repeat(count))
    : fc.oneof(
        fc.integer({ min: 1, max: 3 }).map((count) => ' '.repeat(count)),
        fc.integer({ min: 0, max: 8 }).map((count) => `\n${' '.repeat(count)}`),
      );

const variants = fc.constantFrom(...inputs).chain(({ name, text, gaps }) =>
  fc
    .uniqueArray(fc.constantFrom(...gaps), { minLength: 1, maxLength: 6 })
    .chain((chosen) =>
      fc.tuple(...chosen.map((gap) => whitespace(gap.spacesOnly).map((added) => ({ gap, added })))),
    )
    .map((insertions) => ({
      name,
      text,
      variant: insertions
        .toSorted((first, second) => second.gap.offset - first.gap.offset)
        .reduce(
          (current, { gap, added }) =>
            current.slice(0, gap.offset) + added + current.slice(gap.offset),
          text,
        ),
    })),
);

describe('whitespace where line breaks mean nothing', () => {
  it('changes nothing the formatter prints', () => {
    fc.assert(
      fc.property(variants, ({ text, variant }) => {
        const original = parseText(text);
        const changed = parseText(variant);
        fc.pre(
          changed.diagnostics.length === 0 &&
            dump(changed, changed.root) === dump(original, original.root) &&
            commentTexts(changed).join('\n') === commentTexts(original).join('\n'),
        );
        // The formatter itself, which formats a module its banner keeps as written too.
        expect(formatTree(parseText(variant))).toBe(formatTree(parseText(text)));
      }),
      { numRuns: 300 },
    );
  });
});
