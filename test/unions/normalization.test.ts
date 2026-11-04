/**
 * Union and literal type normalization (docs/proposals/3-union-types.md §1, §3, §4, note 1, note 12):
 * precedence of `|`, set normalization (flattening, deduplication, `Never` removal, lone-member
 * collapse), literal-into-base and member-into-`any` absorption, nominal-vs-shape separation,
 * `T?` as `T | None` (`T??` as `T?`), collapse under generic substitution, and fast-check
 * properties holding `sameType` and `typeKey` to canonical set semantics.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { sameType } from '../../src/compiler/checker/types/identity.ts';
import { typeKeys } from '../../src/compiler/checker/types/type-keys.ts';
import {
  codesOf,
  compareWrittenTypes,
  resolveWrittenTypes,
  runMain,
  spelledTypeOf,
} from './unions.test-kit.ts';

const sharedDecls = [
  'type Point = { x: Int; y: Int }',
  'struct Pixel { x: Int; y: Int }',
  'struct Email { to: String }',
  'struct Plain { id: Int }',
  'trait Notifier:',
  '  fn notify(self: Self) -> String',
  'fn notify(self: Email) -> String: self.to',
  'fn toString(self: Email) -> String: self.to',
];

const sameNormalized = {
  syntaxErrors: [],
  same: true,
  sameKey: true,
  assignCodes: [],
};

describe('union type syntax and precedence (§1)', () => {
  it('binds `|` looser than `?` and type arguments, and tighter than `->`', () => {
    expect(compareWrittenTypes('Int? | String', 'Int | None | String', sharedDecls)).toEqual(
      sameNormalized,
    );
    expect(compareWrittenTypes('Array<Int> | String', 'String | Array<Int>', sharedDecls)).toEqual(
      sameNormalized,
    );
    expect(
      compareWrittenTypes('fn() -> Int | String', 'fn() -> (Int | String)', sharedDecls),
    ).toEqual(sameNormalized);
    expect(
      compareWrittenTypes(
        'any Stringable & Sendable | Int',
        '(any Stringable & Sendable) | Int',
        sharedDecls,
      ),
    ).toEqual(sameNormalized);

    const { types, syntaxErrors } = resolveWrittenTypes([
      'fn() -> Int | String',
      '(fn() -> Int) | String',
    ]);
    expect(syntaxErrors).toEqual([]);
    const [returnsUnion, holdsFn] = types;
    expect(returnsUnion?.kind).toBe('function');
    expect(holdsFn?.kind).not.toBe('function');
    expect(
      returnsUnion !== undefined && holdsFn !== undefined && sameType(returnsUnion, holdsFn),
    ).toBe(false);
  });
});

describe('union normalization (§1, §3, §4)', () => {
  it.each([
    ['commutativity', 'Int | String', 'String | Int'],
    ['associativity and flattening', '(Int | String) | (String | Bool)', 'Bool | Int | String'],
    ['duplicate removal', 'Int | Int | Int', 'Int'],
    ['duplicate literal removal', '"draft" | "draft"', '"draft"'],
    ['Never removal in union', 'Int | Never | String', 'Int | String'],
    ['Never removal leaving lone member', 'Never | "draft" | Never', '"draft"'],
    ['Never | Never is Never', 'Never | Never', 'Never'],
    ['string literal absorbed into String', '"a" | String', 'String'],
    ['multiple string literals absorbed into String', '"a" | "b" | String | Int', 'String | Int'],
    ['int literals (positive and negative) absorbed into Int', '42 | -1 | 0 | Int', 'Int'],
    ['true | false collapses to Bool', 'true | false', 'Bool'],
    ['false | true collapses to Bool', 'false | true', 'Bool'],
    ['true | Bool collapses to Bool', 'true | Bool', 'Bool'],
    ['false | Bool collapses to Bool', 'false | Bool', 'Bool'],
    ['true | false | Int collapses to Bool | Int', 'true | false | Int', 'Bool | Int'],
    ['type meeting an any member merges into it', 'Int | any Stringable', 'any Stringable'],
    ['user struct meeting any member merges into it', 'Email | any Notifier', 'any Notifier'],
    ['literal whose base meets any merges into it', '"hi" | any Stringable', 'any Stringable'],
    ['T? is T | None', 'Int?', 'Int | None'],
    ['Optional<T> alias is T | None', 'Optional<Int>', 'Int | None'],
    ['T?? collapses to T?', 'Int??', 'Int?'],
    ['Optional<Optional<Int>> collapses to Int?', 'Optional<Optional<Int>>', 'Int | None'],
  ])('normalizes %s: `%s` === `%s`', (_rule, left, right) => {
    expect(compareWrittenTypes(left, right, sharedDecls)).toEqual(sameNormalized);
  });

  it('keeps a nominal struct and its equal shape apart in a union', () => {
    const compared = compareWrittenTypes('Pixel | Point', 'Point', sharedDecls);
    expect(compared.syntaxErrors).toEqual([]);
    expect(compared.same).toBe(false);
    expect(compared.sameKey).toBe(false);
  });

  it('keeps a type that does not meet an `any` member separate from it', () => {
    const compared = compareWrittenTypes('Plain | any Notifier', 'any Notifier', sharedDecls);
    expect(compared.syntaxErrors).toEqual([]);
    expect(compared.same).toBe(false);
    expect(compared.sameKey).toBe(false);
  });

  it('collapses unions after generic type-parameter substitution', () => {
    expect(
      runMain('Int', 'idOrInt<Int>(7) + (optOrNone<Int?>(3) ?? 0) + strOrLit<"a">("x").length()', [
        'fn idOrInt<T>(x: T | Int) -> T | Int: x',
        'fn optOrNone<T>(x: T?) -> T?: x',
        'fn strOrLit<T>(x: T | String) -> T | String: x',
      ]),
    ).toBe(11);
  });

  it('makes Map<K, V?>.get(k) return V?, with missing and stored none alike', () => {
    expect(
      runMain(
        'String',
        [
          'const m: Map<String, Int?> = ["present": 5, "empty": none]',
          'const a: Int? = m.get("present")',
          'const b: Int? = m.get("empty")',
          'const c: Int? = m.get("missing")',
          '`${a ?? -1}:${b == none}:${c == none}:${b == c}`',
        ].join('\n  '),
      ),
    ).toBe('5:true:true:true');
  });

  it('spells union types, optionals, literals, and union aliases as written in typeText', () => {
    expect(spelledTypeOf('Status', ['type Status = "draft" | "sent"'])).toBe('Status');
    expect(spelledTypeOf('Int?', sharedDecls)).toBe('Int?');
    expect(spelledTypeOf('"draft"', sharedDecls)).toBe('"draft"');
    expect(spelledTypeOf('-1', sharedDecls)).toBe('-1');
    expect(spelledTypeOf('None', sharedDecls)).toBe('None');
  });

  it('allows a recursive struct whose self-reference is guarded by a union, and rejects recursive aliases', () => {
    expect(
      codesOf(
        'struct Chain { value: Int; rest: Chain | Int }',
        'fn head(c: Chain) -> Int: c.value',
      ),
    ).toEqual([]);
    expect(codesOf('type Endless = Int | Endless')).toEqual([checkerDiagnostics.aliasCycle.code]);
  });
});

/**
 * Atomic type tokens for property testing of union normalization:
 * includes base primitives, literals of each base, `Never`, `None`, shapes, and `Pixel`.
 */
type Atom =
  | 'Int'
  | '0'
  | '1'
  | '-1'
  | 'String'
  | '"a"'
  | '"b"'
  | 'Bool'
  | 'true'
  | 'false'
  | 'None'
  | 'Never'
  | '{ x: Int; y: Int }'
  | '{ y: Int; x: Int }'
  | 'Pixel';

/** Canonical set of members after Proposal 3 §1 normalization. */
function canonicalMembers(atoms: readonly Atom[]): ReadonlySet<string> {
  const set = new Set<string>();
  for (const atom of atoms) {
    if (atom !== 'Never') {
      set.add(
        atom === '{ x: Int; y: Int }' || atom === '{ y: Int; x: Int }' ? '{x:Int,y:Int}' : atom,
      );
    }
  }
  if (set.has('Int')) {
    set.delete('0');
    set.delete('1');
    set.delete('-1');
  }
  if (set.has('String')) {
    set.delete('"a"');
    set.delete('"b"');
  }
  if (set.has('Bool') || (set.has('true') && set.has('false'))) {
    set.add('Bool');
    set.delete('true');
    set.delete('false');
  }
  return set;
}

function sameCanonical(first: readonly Atom[], second: readonly Atom[]): boolean {
  const a = canonicalMembers(first);
  const b = canonicalMembers(second);
  return a.size === b.size && [...a].every((member) => b.has(member));
}

const atomArbitrary: fc.Arbitrary<Atom> = fc.constantFrom(
  'Int',
  '0',
  '1',
  '-1',
  'String',
  '"a"',
  '"b"',
  'Bool',
  'true',
  'false',
  'None',
  'Never',
  '{ x: Int; y: Int }',
  '{ y: Int; x: Int }',
  'Pixel',
);

const unionAtomsArbitrary = fc.array(atomArbitrary, { minLength: 1, maxLength: 6 });

describe('fast-check properties: union normalization and typeKeys (note 12)', () => {
  it('is idempotent, order-free, flattens nested unions, and merges literals into their base', () => {
    fc.assert(
      fc.property(unionAtomsArbitrary, fc.infiniteStream(fc.boolean()), (atoms, grouping) => {
        const forward = atoms.join(' | ');
        const reversed = [...atoms].toReversed().join(' | ');
        const duplicated = [...atoms, ...atoms].join(' | ');
        const parenthesized =
          atoms.length >= 2 && grouping.next().value
            ? `(${atoms.slice(0, Math.ceil(atoms.length / 2)).join(' | ')}) | (${atoms.slice(Math.ceil(atoms.length / 2)).join(' | ')})`
            : forward;
        const { types, syntaxErrors } = resolveWrittenTypes(
          [forward, reversed, duplicated, parenthesized],
          sharedDecls,
        );
        expect(syntaxErrors).toEqual([]);
        const [tForward, tReversed, tDuplicated, tParen] = types;
        const allSame =
          tForward !== undefined &&
          tReversed !== undefined &&
          tDuplicated !== undefined &&
          tParen !== undefined &&
          sameType(tForward, tReversed) &&
          sameType(tForward, tDuplicated) &&
          sameType(tForward, tParen);
        const allSameKey =
          tForward !== undefined &&
          tReversed !== undefined &&
          tDuplicated !== undefined &&
          tParen !== undefined &&
          typeKeys.typeKey(tForward) === typeKeys.typeKey(tReversed) &&
          typeKeys.typeKey(tForward) === typeKeys.typeKey(tDuplicated) &&
          typeKeys.typeKey(tForward) === typeKeys.typeKey(tParen);
        expect(allSame).toBe(true);
        expect(allSameKey).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it('makes `typeKey` equal iff `sameType` holds, matching canonical member-set equality', () => {
    fc.assert(
      fc.property(unionAtomsArbitrary, unionAtomsArbitrary, (first, second) => {
        const expectedSame = sameCanonical(first, second);
        const { types, syntaxErrors } = resolveWrittenTypes(
          [first.join(' | '), second.join(' | ')],
          sharedDecls,
        );
        expect(syntaxErrors).toEqual([]);
        const [a, b] = types;
        const same = a !== undefined && b !== undefined && sameType(a, b);
        const sameKey =
          a !== undefined && b !== undefined && typeKeys.typeKey(a) === typeKeys.typeKey(b);
        expect(same).toBe(expectedSame);
        expect(sameKey).toBe(same);
      }),
      { numRuns: 60 },
    );
  });
});
