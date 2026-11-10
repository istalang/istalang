/**
 * The kinds pass on hand-picked sources.
 */

import { describe, expect, it } from 'vitest';
import { applyEdits } from '../../edits.ts';
import { readIsta } from '../../pass.ts';
import { kinds } from './index.ts';

function rewritten(text: string): string {
  const rewrites = kinds(readIsta('main.ista', text));
  return applyEdits(
    text,
    rewrites.flatMap(({ edits }) => edits),
  );
}

describe('kinds', () => {
  it.each([
    ['async fn f() -> Future<Int>: 1', 'ista async fn f() -> Int: 1'],
    ['async fn main(): 1', 'async fn main(): 1'],
    ['sendable async fn f(): 1', 'sendable ista async fn f(): 1'],
    ['@Test("t")\nasync fn f(): 1', '@Test("t")\nista async fn f(): 1'],
    ['fn f(g: async fn(Int) -> Int): g', 'fn f(g: ista async fn(Int) -> Int): g'],
    ['fn f(x: Future<Future<Int>>): x', 'fn f(x: Future<Future<Int, "ista">, "ista">): x'],
    [
      'async fn f() -> Future<Future<Int>>: x',
      'ista async fn f() -> Future<Future<Int, "ista">, "ista">: x',
    ],
    ['const g = async fn(x): await x', 'const g = async fn(x): await x'],
    ['const g = async fn() -> Future<Int>: 1', 'const g = async fn() -> Int: 1'],
    ['extern ephemeral struct Socket', 'extern live struct Socket'],
    ['ephemeral extern struct Socket', 'live extern struct Socket'],
    ['const ephemeral = 1', 'const ephemeral = 1'],
    [
      'trait T:\n  async fn f(self: Self) -> Future<Int>',
      'trait T:\n  ista async fn f(self: Self) -> Int',
    ],
  ])('%j → %j', (source, expected) => {
    expect(rewritten(source)).toBe(expected);
  });
});
