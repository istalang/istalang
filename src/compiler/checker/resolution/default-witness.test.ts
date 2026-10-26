/**
 * A type's `default()` is Default's witness (§3.10), found beside the type wherever it is used:
 * a map literal of the type and a `@JsonSkip` field of it read back alike, and one declared where
 * it is used serves neither.
 */

import { describe, expect, it } from 'vitest';
import { reported } from '../check.test-kit.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';

const bag = [
  'struct Bag { n: int }',
  'fn setIndex(self: &Bag, key: int, value: int):',
  '  self.n = value',
].join('\n');

const declared = 'fn Bag.default() -> Bag: Bag{n: 0}';

/** What is reported for a map literal of `Bag` and a skipped `Bag` field, beside `inMain`. */
function codesWith(inBag: string, inMain: string): readonly number[] {
  const main = [
    "import JsonSkip from 'json'",
    "import Bag from 'bag.ista'",
    inMain,
    'struct Shelf { bag: Bag @JsonSkip }',
    'fn filled() -> Bag: [1: 1]',
  ].join('\n');
  return reported(main, { 'bag.ista': `${bag}\n${inBag}` }).codes;
}

describe("a type's default()", () => {
  it('declared beside the type, serves a map literal and @JsonSkip', () => {
    expect(codesWith(declared, '')).toEqual([]);
  });

  it('async, gives a future, so meets no Default', () => {
    const slow = 'async fn Bag.default() -> Future<Bag>: Bag{n: 0}';
    expect(codesWith(slow, '')).toEqual([
      checkerDiagnostics.skippedWithoutDefault.code,
      checkerDiagnostics.mapLiteralType.code,
    ]);
  });

  it('declared where it is used, serves neither', () => {
    expect(codesWith('', declared)).toEqual([
      checkerDiagnostics.skippedWithoutDefault.code,
      checkerDiagnostics.mapLiteralType.code,
    ]);
  });
});
