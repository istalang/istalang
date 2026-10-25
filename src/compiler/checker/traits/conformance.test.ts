/**
 * Meeting constraints (§3.10): a required field is met by a field of the same name and type, a
 * required function by a function visible where the constraint is met, with the required
 * result, and Sendable is derived from what a type holds (§3.1).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reported } from '../check.test-kit.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';

const { notConforming } = checkerDiagnostics;

/**
 * Whether checking `text`, beside `others`, reports a constraint not met; throws when it reports
 * anything else, so a case that is met is met cleanly.
 */
function unmet(text: string, others: Readonly<Record<string, string>> = {}): boolean {
  const { codes } = reported(text, others);
  if (codes.some((code) => code !== notConforming.code)) {
    throw new Error(`Unexpected diagnostics ${codes.join(', ')} in:\n${text}`);
  }
  return codes.length > 0;
}

/** Field types, each with a value of that type. */
const fieldTypes = [
  ['int', '1'],
  ['string', '"a"'],
  ['int?', 'none'],
  ['(int, int)', '(1, 2)'],
] as const;

const fields = fc.record({
  name: fc.constantFrom('cents', 'label'),
  type: fc.constantFrom(...fieldTypes),
});

describe('a required field', () => {
  it('is met exactly by a field of the same name and the same type', () => {
    fc.assert(
      fc.property(fields, fields, (required, declared) => {
        const [declaredType, value] = declared.type;
        const text = [
          `trait Priced { ${required.name}: ${required.type[0]} }`,
          `struct Item { ${declared.name}: ${declaredType} }`,
          'fn priceOf<T is Priced>(item: T) -> int: 1',
          `fn main() -> int: priceOf(Item{${declared.name}: ${value}})`,
        ].join('\n');
        const same = required.name === declared.name && required.type === declared.type;
        expect(unmet(text)).toBe(!same);
      }),
      { numRuns: 40 },
    );
  });
});

const monoid = [
  'trait Monoid:',
  '  fn Self.zero() -> Self',
  '  fn add(left: Self, right: Self) -> Self',
  'fn sum<T is Monoid>(a: T, b: T) -> T:',
  '  T.zero() + a + b',
].join('\n');

describe('a required function', () => {
  it.each([
    [
      'is met by a static and a prelude function in scope',
      'fn int.zero() -> int: 0',
      'sum(1, 2)',
      false,
    ],
    ['is unmet when no function of its name is visible', '', 'sum(1, 2)', true],
    [
      'is unmet by a function giving another result',
      'fn int.zero() -> string: "0"',
      'sum(1, 2)',
      true,
    ],
    [
      "is met by a type parameter's own constraint",
      'fn int.zero() -> int: 0\nfn twice<U is Monoid>(a: U) -> U: sum(a, a)',
      'twice(1)',
      false,
    ],
  ])('%s', (_, declared, call, isUnmet) => {
    expect(unmet(`${monoid}\n${declared}\nfn main() -> int: ${call}`)).toBe(isUnmet);
  });

  it('is met through the module declaring the type, without importing the functions', () => {
    const lib = [
      'struct Money { cents: int }',
      'fn Money.zero() -> Money: Money{cents: 0}',
      'fn add(left: Money, right: Money) -> Money: Money{cents: left.cents + right.cents}',
    ].join('\n');
    const call = 'sum(Money{cents: 1}, Money{cents: 2}).cents';
    const main = `import Money from 'lib'\n${monoid}\nfn main() -> int: ${call}`;
    expect(unmet(main, { lib })).toBe(false);
  });
});

describe('Sendable', () => {
  const declarations = [
    'struct Envelope<T is Sendable> { value: T }',
    'struct Money { cents: int }',
    'struct Handler { run: fn() -> int }',
    'struct Tree { children: Array<Tree> }',
  ].join('\n');

  it.each([
    ['int', true],
    ['(int, string)', true],
    ['Money', true],
    ['Tree', true],
    ['int?', true],
    ['Handler', false],
    ['fn() -> int', false],
    ['Array<fn() -> int>', false],
    ['Slot<int>', false],
  ])('holds for %s: %s', (type, isSendable) => {
    const text = `${declarations}\nfn open(envelope: Envelope<${type}>) -> int: 1`;
    expect(unmet(text)).toBe(!isSendable);
  });

  it.each([
    ['a type parameter constrained Sendable', '<T is Sendable>', false],
    ['an unconstrained type parameter', '<T>', true],
  ])('holds for %s only', (_, parameters, isUnmet) => {
    const text = `${declarations}\nfn wrap${parameters}(value: T) -> Envelope<T>: Envelope{value}`;
    expect(unmet(text)).toBe(isUnmet);
  });
});
