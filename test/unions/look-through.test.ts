/**
 * Looking through an `any` member (§2 "Collapse", §3.11): a member an `any` member took whole is
 * still a value of its own type inside it, so written code reaches it as instantiated generic code
 * does. A type or struct pattern naming it downcasts through the `any` member; a value of it, or a
 * union of such values, goes into the union through that member; and a type whose `any` member
 * took `None` whole holds `none`, so `??`, `?.`, `!` and `case none` test it for `none`.
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { codesOf, runMain } from './unions.test-kit.ts';

const declarations = [
  'trait Shows:',
  '  fn show(self: Self) -> String',
  'struct Plain { id: Int }',
  'struct Point { x: Int }',
  'fn show(self: Int) -> String: `i${self}`',
  'fn show(self: Point) -> String: `p${self.x}`',
  'fn tag(v: Plain | any Shows) -> String:',
  '  match v:',
  '    case Int as n: `int:${n}`',
  '    case Point{x}: `point:${x}`',
  '    case Plain: "plain"',
  '    case _: "other"',
];

describe('a pattern on a union with an `any` member', () => {
  it('downcasts through the member a type or struct pattern names a type it took', () => {
    expect(
      runMain(
        'Array<String>',
        'const s: any Shows = "s"\n  [tag(3), tag(Point{x: 2}), tag(Plain{id: 1}), tag(s)]',
        [...declarations, 'fn show(self: String) -> String: self'],
      ),
    ).toEqual(['int:3', 'point:2', 'plain', 'other']);
  });

  it('rules out a type the member never holds', () => {
    expect(
      codesOf(
        ...declarations,
        'fn f(v: Plain | any Shows) -> Int:',
        '  match v:',
        '    case Bool: 1',
        '    case _: 0',
      ),
    ).toEqual([checkerDiagnostics.heldNoValue.code]);
  });
});

describe('a union going into another through its `any` member', () => {
  it('takes each member into the member holding it', () => {
    expect(
      runMain(
        'Array<String>',
        'const a: Int | Plain = 4\n  const b: Int | Plain = Plain{id: 1}\n  [tag(a), tag(b)]',
        declarations,
      ),
    ).toEqual(['int:4', 'plain']);
  });
});

describe('a type whose `any` member took `None` whole', () => {
  const optional = [
    'struct Plain { id: Int }',
    'fn orSeven(x: any Sendable) -> any Sendable: x ?? 7',
    'fn which(x: any Sendable) -> String:',
    '  match x:',
    '    case none: "none"',
    '    case Int as n: `int:${n}`',
    '    case _: "other"',
    'fn forced(x: Plain | any Sendable) -> String: which(x!)',
  ];

  it('is tested for `none` by `??`, `!` and `case none`', () => {
    expect(
      runMain(
        'Array<String>',
        '[which(orSeven(none)), which(orSeven(2)), which(none), which("s"), forced(5)]',
        optional,
      ),
    ).toEqual(['int:7', 'int:2', 'none', 'other', 'int:5']);
  });

  it('panics forcing `none` out of it', () => {
    expect(runMain('String', 'forced(none)', optional)).toMatchObject({ kind: 'panicked' });
  });
});
