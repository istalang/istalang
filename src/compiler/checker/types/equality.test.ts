/**
 * `==` and `!=` (§3.9, §6): two values compare when either fits the other's type, so a member's
 * value compares with its union, a literal's with its base, and two unions only when one holds the
 * other's members.
 */

import { describe, expect, it } from 'vitest';
import { reported } from '../check.test-kit.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';

const { operatorTypes } = checkerDiagnostics;

/** The codes reported for `comparison` between the parameters of a function. */
function comparing(comparison: string): readonly number[] {
  const parameters = 's: "draft" | "sent", name: String, u: Int | String, v: Int | Bool, w: Int';
  return reported(`fn f(${parameters}) -> Bool: ${comparison}`).codes;
}

describe('== with a union on a side', () => {
  it.each([
    ['s == name', []],
    ['name != s', []],
    ['u == 1', []],
    ['w == u', []],
    ['u == none', [operatorTypes.code]],
    ['u == true', [operatorTypes.code]],
    ['u == v', [operatorTypes.code]],
  ])('%s reports %j', (comparison, codes) => {
    expect(comparing(comparison)).toEqual(codes);
  });
});
