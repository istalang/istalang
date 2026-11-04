/**
 * Overload clashes (§3.3, §3.7): whether two functions of one name clash doesn't depend on which
 * is declared first, and the rules for what counts as the same parameters hold pair by pair: a
 * type and a union holding it, a literal type and its base, among them.
 */

import { describe, expect, it } from 'vitest';
import { reported } from '../check.test-kit.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';

/** Signatures of `f`, as written after its name. */
const signatures = [
  '(a: Int)',
  '(a: String)',
  '(a: Int?)',
  '(a: &Int)',
  '<T>(a: T)',
  '<U>(a: U)',
  '<T>(a: T?)',
  '<T>(a: T, b: T)',
  '<T, U>(a: T, b: U)',
  '(a: Int, b: Int = 1)',
  '(a: Int, b: String)',
  '(self: Point)',
  '(self: &Point)',
  '(a: Int | String)',
  '(a: String | Bool)',
  '(a: "a")',
  '(a: "a" | "b")',
] as const;

type Signature = (typeof signatures)[number];

/** Whether declaring `f` with `first`, then with `second`, reports a clash. */
function clashes(first: Signature, second: Signature): boolean {
  const text = `struct Point { x: Int }\nfn f${first} -> Int: 1\nfn f${second} -> Int: 2\n`;
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
    ['(a: Int)', '(a: Int)', true],
    ['(a: Int)', '(a: String)', false],
    ['(a: Int)', '(a: Int?)', true],
    ['(a: Int)', '(a: &Int)', false],
    ['<T>(a: T)', '<U>(a: U)', true],
    ['<T>(a: T)', '<T>(a: T?)', true],
    ['<T>(a: T)', '(a: Int)', false],
    ['<T>(a: T, b: T)', '<T, U>(a: T, b: U)', false],
    ['(a: Int, b: Int = 1)', '(a: Int)', true],
    ['(a: Int, b: Int = 1)', '(a: Int, b: String)', false],
    ['(self: Point)', '(self: &Point)', true],
    ['(a: Int)', '(a: Int | String)', true],
    ['(a: Int?)', '(a: Int | String)', false],
    ['(a: Int | String)', '(a: String | Bool)', false],
    ['(a: "a")', '(a: String)', true],
    ['(a: "a")', '(a: "a" | "b")', true],
    ['(a: "a" | "b")', '(a: String | Bool)', true],
    ['(a: "a" | "b")', '(a: Int)', false],
  ])('%s and %s clash: %s', (first, second, clash) => {
    expect(clashes(first, second)).toBe(clash);
  });
});
