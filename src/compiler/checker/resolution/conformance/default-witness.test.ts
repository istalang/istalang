/**
 * A type's `default()` is Default's witness (§8.2), found beside the type wherever it is used:
 * a map literal of the type and a `@JsonSkip` field of it read back alike, one declared where it
 * is used serves neither, and one giving another type says so.
 */

import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../../../foundation/diagnostics/diagnostic.ts';
import type { Span } from '../../../../foundation/text/span.ts';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { diagnosedAt } from '../../../compile.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

const bag = [
  'struct Bag { n: Int }',
  'fn setIndex(self: &Bag, key: Int, value: Int):',
  '  self.n = value',
].join('\n');

const declared = 'fn Bag.default() -> Bag: Bag{n: 0}';

/** What is reported for a map literal of `Bag` and a skipped `Bag` field, beside `inMain`. */
function reportedWith(inBag: string, inMain: string): readonly Diagnostic<Span, string>[] {
  const main = [
    "import JsonSkip from 'json'",
    "import Bag from 'bag.ista'",
    inMain,
    'struct Shelf { bag: Bag @JsonSkip }',
    'fn filled() -> Bag: [1: 1]',
  ].join('\n');
  const program = stdProgramOf({ 'main.ista': main, 'bag.ista': `${bag}\n${inBag}` });
  return diagnosedAt(program, 'main.ista').diagnostics;
}

const codesOf = (diagnostics: readonly Diagnostic<Span, string>[]) =>
  diagnostics.map(({ code }) => code);

describe("a type's default()", () => {
  it('declared beside the type, serves a map literal and @JsonSkip', () => {
    expect(codesOf(reportedWith(declared, ''))).toEqual([]);
  });

  it('declared where it is used, serves neither, and a map literal says what it needs', () => {
    expect(codesOf(reportedWith('', declared))).toEqual([
      checkerDiagnostics.skippedWithoutDefault.code,
      checkerDiagnostics.mapLiteralType.code,
    ]);
  });

  it('async and ista, meets no Default, whose requirement is unmarked, which a map literal says', () => {
    const slow = 'ista async fn Bag.default() -> Bag: Bag{n: 0}';
    const [skipped, literal] = reportedWith(slow, '');
    expect([skipped?.code, literal?.code]).toEqual([
      checkerDiagnostics.skippedWithoutDefault.code,
      checkerDiagnostics.mapLiteralType.code,
    ]);
  });
});
