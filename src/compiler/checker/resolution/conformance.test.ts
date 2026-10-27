/**
 * Meeting constraints (§3.10): a required field is met by a struct's field of the same name and
 * type, a required function by a function declared beside the type or the trait, with the
 * required result, the same wherever the constraint is met, and Sendable is derived from what a
 * type holds (§3.1).
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
  it("is met exactly by a struct's field of the same name and the same type, named or not", () => {
    fc.assert(
      fc.property(fields, fields, fc.boolean(), (required, declared, isNamed) => {
        const [declaredType, value] = declared.type;
        const field = `${declared.name}: ${declaredType}`;
        const type = isNamed ? 'Item' : `struct { ${field} }`;
        const text = [
          `trait Priced { ${required.name}: ${required.type[0]} }`,
          `struct Item { ${field} }`,
          'fn priceOf<T is Priced>(item: T) -> int: 1',
          'fn main() -> int:',
          `  const item: ${type} = ${isNamed ? 'Item' : 'struct'}{${declared.name}: ${value}}`,
          '  priceOf(item)',
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
      'is unmet by a function taking the type only wrapped into an optional',
      [
        'struct Money { cents: int }',
        'fn Money.zero() -> Money: Money{cents: 0}',
        'fn add<T>(left: T?, right: T?) -> T: panic("unreached")',
      ].join('\n'),
      'sum(Money{cents: 1}, Money{cents: 2}).cents',
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

  it('is met through the module declaring the trait, without importing the functions', () => {
    const lib = [
      'trait Named:',
      '  fn name(self: Self) -> string',
      '  fn Self.anonymous() -> Self',
      'fn name(self: int) -> string: "int"',
      'fn int.anonymous() -> int: 0',
    ].join('\n');
    const main = [
      "import Named from 'lib'",
      'fn named<T is Named>(value: T) -> string: value.name()',
      'fn main() -> string: named(1)',
    ].join('\n');
    expect(unmet(main, { lib })).toBe(false);
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

  it.each([
    ['money', 'money', false],
    ['main', 'money', true],
    ['money', 'main', true],
    ['main', 'main', true],
  ])(
    'with zero in %s and add in %s, is met only by functions beside the type or the trait: unmet %s',
    (zeroIn, addIn, isUnmet) => {
      const zero = 'fn Money.zero() -> Money: Money{cents: 0}';
      const add =
        'fn add(left: Money, right: Money) -> Money: Money{cents: left.cents + right.cents}';
      const placed = (module: string) =>
        [zeroIn === module ? zero : '', addIn === module ? add : ''].join('\n');
      const money = `struct Money { cents: int }\n${placed('money')}`;
      const main = [
        "import Money from 'money'",
        "import sum from 'monoid'",
        placed('main'),
        'fn main() -> int: sum(Money{cents: 1}, Money{cents: 2}).cents',
      ].join('\n');
      expect(unmet(main, { money, monoid })).toBe(isUnmet);
    },
  );
});

describe('a required static function', () => {
  it.each([
    ['dec', false],
    ['main', true],
  ])(
    'taking a type declared in dec, with the function declared in %s, is unmet: %s',
    (declaredIn, isUnmet) => {
      const from = 'fn Money.from(value: Dec) -> Money: Money{cents: value.units}';
      const placed = (module: string) => (declaredIn === module ? from : '');
      const dec = `import Money from 'money'\nstruct Dec { units: int }\n${placed('dec')}`;
      const main = [
        "import Money from 'money'",
        "import Dec from 'dec'",
        placed('main'),
        'fn convert<T is Convertible<Dec>>(value: Dec) -> T: T(value)',
        'fn main() -> int:',
        '  const money: Money = convert(Dec{units: 2})',
        '  money.cents',
      ].join('\n');
      expect(unmet(main, { money: 'struct Money { cents: int }', dec })).toBe(isUnmet);
    },
  );
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
