/**
 * Overload clashes (§3.3, §3.7): whether two functions of one name clash doesn't depend on which
 * is declared first, and they clash where some call fits both and choosing prefers neither: a type
 * beside a union holding it, a literal type beside its base, or a type converting part by part into
 * another, is more specific, so neither clashes, while two functions each narrower somewhere, or
 * alike at some call once each instantiates its own type parameters, clash.
 */

import { describe, expect, it } from 'vitest';
import { reported } from '../../../check.test-kit.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';

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
  '(a: Int, b: Int?)',
  '(a: Int?, b: Int)',
  '(a: Int, b: Int? = none)',
  '(a: Int?, b: Int = 1)',
  '(a: Int, ...b: Array<Int?>)',
  '(a: Int?, ...b: Array<Int>)',
  '(a: Array<Int>)',
  '(a: Array<Int?>)',
  '(a: Array<Int>, b: Array<Int?>)',
  '(a: Array<Int?>, b: Array<Int>)',
  '<T>(a: Array<T>)',
  '<T>(a: Array<T?>)',
  '(a: &Int, b: &Int?)',
  '(a: &Int?, b: &Int)',
  '(a: (Int,))',
  '<T>(a: Slot<T>)',
  '<T>(a: Slot<T?>)',
  '<T>(a: Box<T>)',
  '<T>(a: Box<Box<T>>)',
  '<T>(a: Array<T>, b: Array<Int?>)',
  '<T>(a: Array<Int?>, b: Array<T>)',
  '<T>(a: Int, b: T)',
  '<T>(a: T, b: Int)',
  '<T, U>(a: U, b: T)',
  '<...A>(a: A)',
  '<S in "a" | "b">(a: S)',
  '<T is Stringable>(a: T)',
  '<U>(a: any Stringable)',
  '<T>(a: fn(T) -> Int)',
  '<T>(a: fn(T?) -> Int)',
  '<T>(a: T, b: T, c: Int, d: Int?)',
  '<T>(a: Int, b: T?, c: Int?, d: Int)',
  '<T>(a: Map<T, Int>, b: Int, c: Int?)',
  '<T>(a: Map<Int, T>, b: Int?, c: Int)',
] as const;

type Signature = (typeof signatures)[number];

/** Whether declaring `f` with `first`, then with `second`, reports a clash. */
function clashes(first: Signature, second: Signature): boolean {
  const text = `struct Point { x: Int }\nstruct Box<T> { value: T }\nfn f${first} -> Int: 1\nfn f${second} -> Int: 2\n`;
  return reported(text).codes.includes(checkerDiagnostics.overloadClash.code);
}

describe('overload clashes', () => {
  it("don't depend on which function is declared first", () => {
    for (const [index, first] of signatures.entries()) {
      for (const second of signatures.slice(index + 1)) {
        expect(clashes(first, second), `${first} and ${second}`).toBe(clashes(second, first));
      }
    }
  });

  it.each<[Signature, Signature, boolean]>([
    ['(a: Int)', '(a: Int)', true],
    ['(a: Int)', '(a: String)', false],
    ['(a: Int)', '(a: Int?)', false],
    ['(a: Int)', '(a: &Int)', false],
    ['<T>(a: T)', '<U>(a: U)', true],
    ['<T>(a: T)', '<T>(a: T?)', true],
    ['<T>(a: T)', '(a: Int)', false],
    ['<T>(a: T, b: T)', '<T, U>(a: T, b: U)', false],
    ['(a: Int, b: Int = 1)', '(a: Int)', true],
    ['(a: Int, b: Int = 1)', '(a: Int, b: String)', false],
    ['(self: Point)', '(self: &Point)', true],
    ['(a: Int)', '(a: Int | String)', false],
    ['(a: Int?)', '(a: Int | String)', false],
    ['(a: Int | String)', '(a: String | Bool)', false],
    ['(a: "a")', '(a: String)', false],
    ['(a: "a")', '(a: "a" | "b")', false],
    ['(a: "a" | "b")', '(a: String | Bool)', false],
    ['(a: Int, b: Int?)', '(a: Int?, b: Int)', true],
    ['(a: Int, b: Int? = none)', '(a: Int?, b: Int = 1)', true],
    ['(a: Int, ...b: Array<Int?>)', '(a: Int?, ...b: Array<Int>)', true],
    ['(a: "a" | "b")', '(a: Int)', false],
    ['(a: Array<Int>)', '(a: Array<Int?>)', false],
    ['(a: Array<Int>, b: Array<Int?>)', '(a: Array<Int?>, b: Array<Int>)', true],
    ['<T>(a: Array<T>)', '<T>(a: Array<T?>)', true],
    ['(a: &Int, b: &Int?)', '(a: &Int?, b: &Int)', false],
    ['(a: Int)', '(a: (Int,))', false],
    ['<T>(a: Slot<T>)', '<T>(a: Slot<T?>)', true],
    ['<T>(a: Box<T>)', '<T>(a: Box<Box<T>>)', true],
    ['<T>(a: T)', '<T>(a: Array<T>)', true],
    ['<T>(a: Array<T>, b: Array<Int?>)', '<T>(a: Array<Int?>, b: Array<T>)', true],
    ['<T>(a: Int, b: T)', '<T>(a: T, b: Int)', true],
    ['<T, U>(a: T, b: U)', '<T, U>(a: U, b: T)', true],
    ['<...A>(a: A)', '<T>(a: T)', true],
    ['<...A>(a: A)', '<T>(a: T?)', false],
    ['<S in "a" | "b">(a: S)', '<T>(a: T?)', false],
    ['<T is Stringable>(a: T)', '<U>(a: any Stringable)', true],
    ['<T>(a: fn(T) -> Int)', '<T>(a: fn(T?) -> Int)', true],
    ['<T>(a: T, b: T, c: Int, d: Int?)', '<T>(a: Int, b: T?, c: Int?, d: Int)', true],
    ['<T>(a: Map<T, Int>, b: Int, c: Int?)', '<T>(a: Map<Int, T>, b: Int?, c: Int)', true],
  ])('%s and %s clash: %s', (first, second, clash) => {
    expect(clashes(first, second)).toBe(clash);
  });
});
