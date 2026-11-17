/**
 * Places a key reads (docs/proposals/4-computed-types.md §8): a value written where a key of
 * several names reads the place converts into whichever field the key names, also when an
 * instantiation leaves the key one name (test/AGENTS.md, commutation); field steps past such a key
 * reach the part of whichever field it names; and an element written past it is refused, since
 * `setIndex` takes its container by `&` (§3.7).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { slowTestTimeout } from '../timeouts.ts';
import { codesOf, runMain } from '../written-types.test-kit.ts';

describe('a write through a key of several names', () => {
  it('converts into the one field an instantiation leaves the key naming', async () => {
    const generic = [
      'struct Solo { a: Int? }',
      'fn reset<S is struct { [_]: Int? }>(s: &S, k: keyof S):',
      '  s[k] = 0',
    ];
    expect(
      await runMain('Int', 'let s = Solo{a: none}\n  reset(&s, "a")\n  s.a ?? 7', generic),
    ).toBe(0);
    const member = [
      'struct P2 { a: Int?, b: Int? }',
      'fn reset<K in "a" | "b">(s: &P2, k: "a" | K):',
      '  s[k] = 0',
    ];
    const body = 'let p = P2{a: none, b: none}\n  reset<"a">(&p, "a")\n  p.a ?? 7';
    expect(await runMain('Int', body, member)).toBe(0);
  });

  it('reaches the part of whichever field it names through the steps past it', async () => {
    const declarations = [
      'struct Item { count: Int }',
      'struct Pair { left: Item, right: Item }',
      'fn setCount(p: &Pair, k: keyof Pair):',
      '  p[k].count = 1',
      'fn bump(p: &Pair, k: keyof Pair):',
      '  p[k].count += 5',
      'fn readCount(p: Pair, k: keyof Pair) -> Int: p[k].count',
    ];
    const body = [
      'let p = Pair{left: Item{count: 0}, right: Item{count: 0}}',
      'setCount(&p, "right")',
      'bump(&p, "right")',
      'bump(&p, "left")',
      '`${p.left.count}:${p.right.count}:${readCount(p, "right")}`',
    ].join('\n  ');
    expect(await runMain('String', body, declarations)).toBe('5:6:6');
  });

  it('reaches a field of a field when two keys of several names read the place', async () => {
    const declarations = [
      'struct Inner { x: Int?, y: Int? }',
      'struct Outer { first: Inner, second: Inner }',
      'fn set(o: &Outer, k: keyof Outer, j: keyof Inner):',
      '  o[k][j] = 4',
    ];
    const body = [
      'let o = Outer{first: Inner{x: none, y: none}, second: Inner{x: none, y: none}}',
      'set(&o, "second", "y")',
      '`${o.first.x ?? 0}${o.first.y ?? 0}${o.second.x ?? 0}${o.second.y ?? 0}`',
    ].join('\n  ');
    expect(await runMain('String', body, declarations)).toBe('0004');
  });

  it("refuses an element written past it, whose setIndex takes the place by '&'", () => {
    const codes = codesOf(
      'struct Pair { left: Array<Int>, right: Array<Int> }',
      'fn setFirst(p: &Pair, k: keyof Pair):',
      '  p[k][0] = 1',
    );
    expect(codes).toEqual([5165]);
  });
});

const names = ['delta', 'alpha', 'omega', 'beta'];

describe('writes through a generic key commute with the substituted program', () => {
  it('a key of several names, or of one, converts each write as writing the field by name does', {
    timeout: slowTestTimeout,
  }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray(names, { minLength: 1, maxLength: 4 }),
        fc.nat(),
        async (fields, pick) => {
          const written = fields[pick % fields.length] ?? 'delta';
          const declarations = [
            `struct Gen { ${fields.map((name) => `${name}: Int?`).join(', ')} }`,
            'fn generic<S is struct { [_]: Int? }>(s: &S, k: keyof S):',
            '  s[k] = 3',
            'fn concrete(s: &Gen, k: keyof Gen):',
            '  s[k] = 3',
          ];
          const empty = fields.map((name) => `${name}: none`).join(', ');
          const read = (variable: string) =>
            fields.map((name) => `(${variable}.${name} ?? 0)`).join(' + ');
          const body = [
            `let a = Gen{${empty}}`,
            `let b = Gen{${empty}}`,
            `let c = Gen{${empty}}`,
            `generic(&a, "${written}")`,
            `concrete(&b, "${written}")`,
            `c.${written} = 3`,
            `[${read('a')}, ${read('b')}, ${read('c')}]`,
          ].join('\n  ');
          expect(await runMain('Array<Int>', body, declarations)).toEqual([3, 3, 3]);
        },
      ),
      { numRuns: 12 },
    );
  });
});
