/**
 * Who has an associated type, and what one meets (docs/proposals/4-computed-types.md §1, spec §3.1,
 * §3.10): only a type's own declaration declares one, so a union or an `any` type has none and
 * never meets a trait requiring one where a type must meet it, while a call through such a trait
 * on a union value still runs its member's function; `T.Data` is one type, meeting the bound of
 * every trait of `T` requiring `Data`; a shared struct declares them as any struct does.
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { codesOf, runMain } from './computed.test-kit.ts';

const labelled = [
  'trait Labelled:',
  '  type Meta',
  '  fn label(self: Self) -> String',
  'struct A { type Meta = Int }',
  'struct B { type Meta = String }',
  'fn label(self: A) -> String: "a"',
  'fn label(self: B) -> String: "b"',
  'fn metaOf<T is Labelled>(x: T, meta: T.Meta) -> String: x.label()',
];

describe('a union or an `any` type has no associated type', () => {
  it('meets no trait requiring one as a type argument', () => {
    expect(codesOf(...labelled, 'fn f(u: A | B) -> String: metaOf(u, 1)')).toEqual([
      checkerDiagnostics.notConforming.code,
    ]);
    expect(codesOf(...labelled, 'fn f(u: A | B) -> String: metaOf<A | B>(u, 1)')).toContain(
      checkerDiagnostics.notConforming.code,
    );
    expect(
      codesOf(...labelled, 'fn f(x: any Labelled) -> String: metaOf<any Labelled>(x, 1)'),
    ).toContain(checkerDiagnostics.notConforming.code);
  });

  it('is read through no union or `any` type', () => {
    expect(codesOf(...labelled, 'fn f(x: (A | B).Meta): ()')).toEqual([
      checkerDiagnostics.noAssociatedType.code,
    ]);
    expect(codesOf(...labelled, 'fn f(x: (any Labelled).Meta): ()')).toEqual([
      checkerDiagnostics.noAssociatedType.code,
    ]);
  });

  it('still calls through the trait on a union value, each member with its own', async () => {
    expect(
      await runMain('String', 'const u: A | B = B\n  `${u.label()}${metaOf(A, 7)}`', labelled),
    ).toBe('ba');
  });
});

describe('`T.Data` is one type', () => {
  const decls = [
    'trait Show:',
    '  fn show(self: Self) -> String',
    'trait Size:',
    '  fn size(self: Self) -> Int',
    'trait HasShown:',
    '  type Data is Show',
    'trait HasSized:',
    '  type Data is Size',
    'struct Both { type Data = Int }',
    'fn show(self: Int) -> String: `#${self}`',
    'fn size(self: Int) -> Int: self * 2',
    'fn both<T is HasShown & HasSized>(d: T.Data) -> String: `${d.show()}/${d.size()}`',
  ];

  it('meets the bound of every trait requiring it', async () => {
    expect(await runMain('String', 'both<Both>(21)', decls)).toBe('#21/42');
  });

  it('is met only by a type meeting every bound', () => {
    expect(
      codesOf(
        ...decls,
        'struct OnlyShown { type Data = String }',
        'fn show(self: String) -> String: self',
        'fn f(): _ = both<OnlyShown>("x")',
      ),
    ).toContain(checkerDiagnostics.notConforming.code);
  });
});

describe('a shared struct', () => {
  it('declares associated types as any struct does', async () => {
    const decls = ['shared struct Inbox<T>:', '  items: Array<T>', '  type Item = T'];
    expect(await runMain('Int', 'const x: Inbox<Int>.Item = 4\n  x + 1', decls)).toBe(5);
  });
});
