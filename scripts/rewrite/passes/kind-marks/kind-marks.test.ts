/**
 * The kind-marks pass on hand-picked sources: the marks the checker's errors ask for, through
 * callers, and nothing where none is asked.
 */

import { describe, expect, it } from 'vitest';
import { applyEdits } from '../../edits.ts';
import { readIsta } from '../../pass.ts';
import { kindMarks } from './index.ts';

function rewritten(text: string): string {
  const rewrites = kindMarks(readIsta('main.ista', text));
  return applyEdits(
    text,
    rewrites.flatMap(({ edits }) => edits),
  );
}

describe('kind-marks', () => {
  it.each([
    ['fn f() -> Int: 1', 'fn f() -> Int: 1'],
    [
      'ista async fn x() -> Int: 1\nasync fn main():\n  _ = await x()',
      'ista async fn x() -> Int: 1\nista async fn main():\n  _ = await x()',
    ],
    [
      'ista async fn x() -> Int: 1\nfn y(): _ = x()\nfn z(): y()',
      'ista async fn x() -> Int: 1\nista fn y(): _ = x()\nista fn z(): y()',
    ],
    ['live fn x(): ()\nsendable fn y(): x()', 'live fn x(): ()\nsendable live fn y(): x()'],
    [
      'ista async fn x() -> Int: 1\nasync fn main():\n  const g = fn(): x()\n  _ = g()',
      'ista async fn x() -> Int: 1\nista async fn main():\n  const g = fn(): x()\n  _ = g()',
    ],
    ['fn f(s: Slot<Int>): ()', 'ista fn f(s: Slot<Int>): ()'],
    ['fn f<M in Mark>(g: Fn<(), Unit, M>): g()', 'fn f<M in Mark>(g: Fn<(), Unit, M>): g()'],
  ])('%j becomes %j', (before, after) => {
    expect(rewritten(before)).toBe(after);
  });
});
