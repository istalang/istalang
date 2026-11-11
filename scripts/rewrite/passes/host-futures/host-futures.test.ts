/**
 * The host-futures pass on hand-picked sources: an extern giving an ista future made the host's
 * live one, in either spelling, each call of it in ista code delegated through `runtime` as the
 * source imports it or as an import the pass adds, and std sources and live code left alone.
 */

import { describe, expect, it } from 'vitest';
import { applyEdits } from '../../edits.ts';
import { readIsta } from '../../pass.ts';
import { hostFutures } from './index.ts';

function rewritten(text: string, path = 'main.ista'): string {
  const rewrites = hostFutures(readIsta(path, text));
  return applyEdits(
    text,
    rewrites.flatMap(({ edits }) => edits),
  );
}

describe('host futures', () => {
  it.each([
    [
      'extern ista async fn fetch(u: String) -> Int\nista async fn f() -> Int: await fetch("a")',
      'import * as runtime from \'runtime\'\nextern live async fn fetch(u: String) -> Int\nista async fn f() -> Int: await runtime.delegate fetch("a")',
    ],
    [
      'import * as rt from \'runtime\'\nextern ista fn fetch(u: String) -> Future<Int, "ista">\nista async fn f() -> Int:\n  const pending = fetch("a")\n  await pending',
      'import * as rt from \'runtime\'\nextern live async fn fetch(u: String) -> Int\nista async fn f() -> Int:\n  const pending = rt.delegate fetch("a")\n  await pending',
    ],
    [
      "import * as time from 'time'\nextern ista async fn fetch() -> Int\nlive async fn g() -> Int: 1",
      "import * as time from 'time'\nextern live async fn fetch() -> Int\nlive async fn g() -> Int: 1",
    ],
    [
      'extern fn plain() -> Int\nextern live async fn live() -> Int',
      'extern fn plain() -> Int\nextern live async fn live() -> Int',
    ],
  ])('rewrites %j', (text, expected) => {
    expect(rewritten(text)).toBe(expected);
  });

  it("leaves a std module's ista externs, which are the runtime's", () => {
    const text = 'extern ista fn commit() -> Future<Unit, "ista">';
    expect(rewritten(text, 'src/stdlib/runtime/runtime.ista')).toBe(text);
  });

  it("leaves an excerpt of the prelude, declaring its own Future, as the runtime's", () => {
    const text = [
      'extern shared struct Future<T, K in Persistence> { type Mode = K }',
      'extern ista fn take<T>(self: Slot<T>) -> Future<T, "ista">',
    ].join('\n');
    expect(rewritten(text, 'docs/spec.md')).toBe(text);
  });
});
