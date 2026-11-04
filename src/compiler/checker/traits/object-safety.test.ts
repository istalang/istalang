/**
 * Object safety (§3.10): each way a trait can't follow `any` gives its own reason, the trait's
 * parameters counting as `Self` where its arguments make them so, and a trait using `Self` only as
 * its functions' receivers can.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { diagnosedAt } from '../../compile.test-kit.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';

const { notObjectSafe } = checkerDiagnostics;

/**
 * What is reported for `any` taking `trait`, the trait `Tested` declared by `declaration`: each
 * diagnostic's code, and the reason ending its message.
 */
function unsafety(declaration: string, trait = 'Tested') {
  const text = `${declaration}\n\nfn taking(x: any ${trait}):\n  ()\n`;
  const { diagnostics } = diagnosedAt(stdProgramOf({ 'main.ista': text }), 'main.ista');
  return {
    codes: diagnostics.map(({ code }) => code),
    reasons: diagnostics.map(({ message }) =>
      message.slice(message.lastIndexOf(', but ') + ', but '.length, -'.'.length),
    ),
  };
}

describe('a trait following any', () => {
  it.each([
    ['trait Tested:\n  next: Self?', "its field 'next' has a type built from Self"],
    ['trait Tested:\n  fn Self.zero() -> Self', "'zero' is static"],
    ['trait Tested:\n  fn count(n: Int) -> Int', "'count' doesn't take Self first"],
    [
      'trait Tested:\n  fn same(self: Self, other: Self) -> Bool',
      "'same' takes Self after its receiver",
    ],
    [
      'trait Tested:\n  fn copied(self: Self) -> Array<Self>',
      "'copied' gives a type built from Self",
    ],
    [
      'trait Tested<C = Self>:\n  fn joined(self: Self, other: C) -> Int',
      "'joined' takes Self after its receiver",
    ],
  ])('%s is refused: %s', (declaration, reason) => {
    expect(unsafety(declaration)).toEqual({ codes: [notObjectSafe.code], reasons: [reason] });
  });

  it.each([
    ['trait Tested:\n  fn name(self: Self) -> String', 'Tested'],
    ['trait Tested:\n  fn rename(self: &Self, name: String)', 'Tested'],
    ['trait Tested<C = Self>:\n  fn joined(self: Self, other: C) -> Int', 'Tested<Int>'],
    ['trait Tested:\n  label: String', 'Tested'],
  ])('%s is taken as %s', (declaration, trait) => {
    expect(unsafety(declaration, trait)).toEqual({ codes: [], reasons: [] });
  });
});
