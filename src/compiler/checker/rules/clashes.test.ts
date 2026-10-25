/**
 * Overload clashes (§3.3, §3.7): whether two functions of one name clash doesn't depend on which
 * is declared first, and the rules for what counts as the same parameters hold pair by pair.
 */

import { describe, expect, it } from 'vitest';
import { reported } from '../check.test-kit.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';

/** Signatures of `f`, as written after its name. */
const signatures = [
  '(a: int)',
  '(a: string)',
  '(a: int?)',
  '(a: &int)',
  '<T>(a: T)',
  '<U>(a: U)',
  '<T>(a: T?)',
  '<T>(a: T, b: T)',
  '<T, U>(a: T, b: U)',
  '(a: int, b: int = 1)',
  '(a: int, b: string)',
  '(self: Point)',
  '(self: &Point)',
] as const;

type Signature = (typeof signatures)[number];

/** Whether declaring `f` with `first`, then with `second`, reports a clash. */
function clashes(first: Signature, second: Signature): boolean {
  const text = `struct Point { x: int }\nfn f${first} -> int: 1\nfn f${second} -> int: 2\n`;
  return reported(text).codes.includes(checkerDiagnostics.overloadClash.code);
}

describe('overload clashes', () => {
  it("don't depend on which function is declared first", () => {
    for (const first of signatures) {
      for (const second of signatures) {
        expect(clashes(first, second), `${first} and ${second}`).toBe(clashes(second, first));
      }
    }
  });

  it.each<[Signature, Signature, boolean]>([
    ['(a: int)', '(a: int)', true],
    ['(a: int)', '(a: string)', false],
    ['(a: int)', '(a: int?)', true],
    ['(a: int)', '(a: &int)', false],
    ['<T>(a: T)', '<U>(a: U)', true],
    ['<T>(a: T)', '<T>(a: T?)', true],
    ['<T>(a: T)', '(a: int)', false],
    ['<T>(a: T, b: T)', '<T, U>(a: T, b: U)', false],
    ['(a: int, b: int = 1)', '(a: int)', true],
    ['(a: int, b: int = 1)', '(a: int, b: string)', false],
    ['(self: Point)', '(self: &Point)', true],
  ])('%s and %s clash: %s', (first, second, clash) => {
    expect(clashes(first, second)).toBe(clash);
  });
});
