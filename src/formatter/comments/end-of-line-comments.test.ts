/**
 * An end-of-line comment stays at the end of its line, after the code it was written after
 * (formatter.md, Decisions), wherever its item stands: last in an indented list of items (a body,
 * members, cases, an indented value's entries, a broken list), at any depth, with or without
 * something after the list. A comment is anchored by the code token before it, counted without the
 * `,` and `;` the formatter may add or drop.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scan } from '../../compiler/scanner/scan.ts';
import type { SyntaxTree } from '../../compiler/syntax/tree/index.ts';
import { parseText, roundTripOf } from '../format.test-kit.ts';
import { describeComment } from './comments.ts';

/** Each comment of `tree`: whether it stands on a line of its own, and its anchoring token. */
function commentAnchors(tree: SyntaxTree): readonly (readonly [boolean, number])[] {
  const code = scan(tree.source).tokens.filter(
    ({ kind }) => kind !== ',' && kind !== ';' && kind !== 'end',
  );
  return tree.comments.map((comment) => [
    describeComment(tree.source, comment).ownLine,
    code.findLastIndex(({ span }) => span.end <= comment.span.start),
  ]);
}

interface ItemList {
  /** The lines opening the list, the last of which its items stand under. */
  readonly header: string;
  readonly item: (index: number) => string;
  /** The line closing the list, at the header's depth, if it has one. */
  readonly footer?: string;
}

/** Lists that stand at the top of a module. */
const declarations: readonly ItemList[] = [
  { header: 'enum E:', item: (index) => `A${index}` },
  { header: 'struct S:', item: (index) => `f${index}: Int` },
  { header: 'trait T:', item: (index) => `fn m${index}(self: Self) -> Int` },
  { header: 'type S = {', item: (index) => `f${index}: Int`, footer: '}' },
  { header: 'fn f() -> Int:', item: (index) => `g${index}()` },
];

/** Lists that stand at the top of a module or in a body. */
const constants: readonly ItemList[] = [
  { header: 'const v = S:', item: (index) => `f${index}: ${index}` },
  { header: 'const v = Array<Int>:', item: (index) => `- ${index}` },
  { header: 'const v = [', item: (index) => `${index}`, footer: ']' },
];

/** Lists that stand only in a body. */
const statements: readonly ItemList[] = [
  ...constants,
  { header: 'match x:', item: (index) => `case ${index}: ${index}` },
  { header: 'if a:', item: (index) => `g${index}()` },
  { header: 'for x in xs:', item: (index) => `g${index}(x)` },
];

const indent = (depth: number, line: string): string => `${'  '.repeat(depth)}${line}`;

interface Input {
  readonly list: ItemList;
  /** The headers of the bodies the list stands in, outermost first. */
  readonly enclosing: readonly string[];
  /** Which items end in a comment. */
  readonly commented: readonly boolean[];
  /** How many of the enclosing bodies a line after the list stands in, if one follows it. */
  readonly afterLevel: number | null;
}

/** `input`'s module: a declaration after the list at the top, a statement in a body. */
function listText({ list, enclosing, commented, afterLevel }: Input): string {
  const depth = enclosing.length;
  const level = Math.min(afterLevel ?? 0, depth);
  return `${[
    ...enclosing.map((header, nesting) => indent(nesting, header)),
    indent(depth, list.header),
    ...commented.map((comment, index) =>
      indent(depth + 1, `${list.item(index)}${comment ? ` # c${index}` : ''}`),
    ),
    ...(list.footer === undefined ? [] : [indent(depth, list.footer)]),
    ...(afterLevel === null ? [] : [indent(level, level === 0 ? 'fn later(): 0' : 'z')]),
  ].join('\n')}\n`;
}

const commentedItems = fc.array(fc.boolean(), { minLength: 1, maxLength: 3 });
const afterLevels = fc.option(fc.nat({ max: 3 }));

const inputs: fc.Arbitrary<Input> = fc.oneof(
  fc.record({
    list: fc.constantFrom(...declarations, ...constants),
    enclosing: fc.constant<readonly string[]>([]),
    commented: commentedItems,
    afterLevel: afterLevels,
  }),
  fc.record({
    list: fc.constantFrom(...statements),
    enclosing: fc.constantFrom<readonly string[]>(
      ['fn outer():'],
      ['fn outer():', 'if b:'],
      ['fn outer():', 'for y in ys:', 'while c:'],
    ),
    commented: commentedItems,
    afterLevel: afterLevels,
  }),
);

describe('an end-of-line comment on an item of an indented list', () => {
  it('stays at the end of its line, after the code it followed, however the list ends', () => {
    fc.assert(
      fc.property(inputs, (input) => {
        const text = listText(input);
        const tree = parseText(text);
        expect(tree.diagnostics).toEqual([]);
        const { actual, expected, reparsed } = roundTripOf(text);
        expect(actual).toEqual(expected);
        expect(commentAnchors(reparsed)).toEqual(commentAnchors(tree));
      }),
    );
  });
});
