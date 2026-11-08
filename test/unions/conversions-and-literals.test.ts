/**
 * Conversions into unions and literal types (docs/proposals/3-union-types.md §2, §3, §4):
 * exact-member preference, single-step conversions (`any`, shape, async fn, 1-tuple, literal to
 * base), multi-conversion ambiguity refusal, union widening, whole-value-only restriction,
 * building from the expected union member, `?` error-union propagation, type-parameter inference
 * against unions, never-inferred unions, literal type rules, and `<` call parsing with literal
 * and union type arguments.
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { codesOf, hoverCodeAt, runMain } from './unions.test-kit.ts';

const baseDecls = [
  'type Status = "draft" | "sent" | "failed"',
  'type Point = { x: Int, y: Int }',
  'struct Pixel { x: Int, y: Int }',
  'struct Email { to: String }',
  'enum Color { Red, Green }',
  'fn toString(self: Email) -> String: "mail:" + self.to',
];

describe('conversions into a union (§2)', () => {
  it('prefers an exact member match over a conversion to another member', () => {
    expect(
      runMain('String', 'which(Pixel{x: 3, y: 4}) + ":" + which(struct{x: 1, y: 2})', [
        ...baseDecls,
        'fn which(v: Pixel | Point) -> String:',
        '  match v:',
        '    case Pixel{x}: "pixel:" + String(x)',
        '    case Point{x}: "point:" + String(x)',
      ]),
    ).toBe('pixel:3:point:1');
  });

  it('converts into the single matching member via any, shape, async fn, 1-tuple, or literal base', () => {
    expect(
      runMain(
        'String',
        [
          'const a: (any Stringable) | Bool = Email{to: "cfo"}',
          'const b: Point | String = Pixel{x: 2, y: 5}',
          'const c: (async fn(Int) -> Int) | String = fn(n: Int) -> Int: n + 1',
          'const d: Int | String = (9,)',
          'const e: (Int,) | String = 4',
          'const f: "draft" = "draft"',
          'const g: String | Bool = f',
          'const aText = match a:',
          '  case Bool: "bool"',
          '  case s: String(s)',
          'const bText = match b:',
          '  case Point{x, y}: String(x + y)',
          '  case s: s',
          'const cVal = match c:',
          '  case String: 0',
          '  case fnVal: await fnVal(10)',
          'const dVal = match d:',
          '  case Int as n: n',
          '  case _: 0',
          'const eVal = match e:',
          '  case String: 0',
          '  case tup: tup.0',
          'const gText = match g:',
          '  case Bool: "b"',
          '  case s: s',
          '`${aText}|${bText}|${cVal}|${dVal}|${eVal}|${gText}`',
        ].join('\n  '),
        baseDecls,
      ),
    ).toBe('mail:cfo|7|11|9|4|draft');
  });

  it('converts a narrow union into a wider union', () => {
    expect(
      runMain(
        'String',
        [
          'const small: "draft" | "sent" = "sent"',
          'const wide: Status = small',
          'const wider: String | Int = wide',
          'match wider:',
          '  case Int as n: String(n)',
          '  case s: s',
        ].join('\n  '),
        baseDecls,
      ),
    ).toBe('sent');
  });

  it('rejects a value that converts into several members of a union', () => {
    expect(
      codesOf(
        'trait A:',
        '  fn a(self: Self) -> Int',
        'trait B:',
        '  fn b(self: Self) -> Int',
        'struct Both { n: Int }',
        'fn a(self: Both) -> Int: self.n',
        'fn b(self: Both) -> Int: self.n',
        'fn take(x: (any A) | (any B)) -> Int: 0',
        'fn bad(v: Both) -> Int: take(v)',
      ).length,
    ).toBeGreaterThan(0);

    expect(
      codesOf('fn take(x: (Int,) | (any Stringable)) -> Int: 0', 'fn bad() -> Int: take(42)')
        .length,
    ).toBeGreaterThan(0);
  });

  it('converts into a union inside a value type, never inside a handle or through a `&`', () => {
    expect(
      codesOf(
        'fn takeArray(xs: Array<Int | String>) -> Int: xs.length()',
        'fn takeField(s: { v: Int | String }) -> Int: 0',
        'fn takeSlot(s: Slot<Int | String>) -> Int: 0',
        'fn takeRef(r: &(Int | String)): ()',
        'fn takeOptRef(r: &Int?): ()',
        'fn bad(xs: Array<Int>, s: { v: Int }, slot: Slot<Int>):',
        '  let n = 1',
        '  _ = takeArray(xs)',
        '  _ = takeField(s)',
        '  _ = takeSlot(slot)',
        '  takeRef(&n)',
        '  takeOptRef(&n)',
      ),
    ).toEqual([
      checkerDiagnostics.typeMismatch.code,
      checkerDiagnostics.typeMismatch.code,
      checkerDiagnostics.typeMismatch.code,
    ]);
  });

  it('builds struct/array/map literals, lambdas, bare variants, and literals from the one expected member they fit', () => {
    expect(
      runMain(
        'String',
        [
          'const pt: Point | String = struct{x: 3, y: 4}',
          'const arr: Array<Int>? = []',
          'const mp: Map<String, Int>? = [:]',
          'const fnU: (fn(Int) -> Int) | String = fn(x): x * 3',
          'const col: Color | Int = Red',
          'const lit: "draft" | Int = "draft"',
          'const pSum = match pt:',
          '  case Point{x, y}: x + y',
          '  case _: 0',
          'const aLen = arr?.length() ?? -1',
          'const mLen = mp?.size() ?? -1',
          'const fRes = match fnU:',
          '  case String: 0',
          '  case f: f(4)',
          'const cRes = match col:',
          '  case Red: "r"',
          '  case Green: "g"',
          '  case Int: "i"',
          '`${pSum}:${aLen}:${mLen}:${fRes}:${cRes}:${lit}`',
        ].join('\n  '),
        baseDecls,
      ),
    ).toBe('7:0:0:12:r:draft');
  });

  it('rejects expected-type constructions that fit zero or several members of a union', () => {
    expect(
      codesOf('fn badArray():', '  const xs: Array<Int> | Array<String> = []', '  _ = xs').length,
    ).toBeGreaterThan(0);

    expect(
      codesOf(
        'fn badLambda():',
        '  const f: (fn(Int) -> Int) | (fn(String) -> String) = fn(x): x',
        '  _ = f',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('propagates `Err` with `?` when its error type converts into the enclosing function error union', () => {
    const errDecls = [
      'struct NotFound { id: String }',
      'struct Timeout { ms: Int }',
      'struct Denied { role: String }',
      'fn find(ok: Bool) -> Result<Int, NotFound>:',
      '  if ok: Ok(10) else: Err(NotFound{id: "p1"})',
      'fn wait(ok: Bool) -> Result<Int, Timeout>:',
      '  if ok: Ok(20) else: Err(Timeout{ms: 500})',
      'fn both(a: Bool, b: Bool) -> Result<Int, NotFound | Timeout>:',
      '  const x = find(a)?',
      '  const y = wait(b)?',
      '  Ok(x + y)',
    ];
    expect(
      runMain(
        'String',
        [
          'const r1 = both(true, true)',
          'const r2 = both(false, true)',
          'const r3 = both(true, false)',
          'fn show(r: Result<Int, NotFound | Timeout>) -> String:',
          '  match r:',
          '    case Ok(value): String(value)',
          '    case Err(error):',
          '      match error:',
          '        case NotFound{id}: "nf:" + id',
          '        case Timeout{ms}: "to:" + String(ms)',
          '`${show(r1)}|${show(r2)}|${show(r3)}`',
        ].join('\n  '),
        errDecls,
      ),
    ).toBe('30|nf:p1|to:500');

    expect(
      codesOf(
        ...errDecls,
        'fn wrong() -> Result<Int, NotFound | Timeout>:',
        '  const r: Result<Int, Denied> = Err(Denied{role: "guest"})',
        '  Ok(r?)',
      ),
    ).toEqual([checkerDiagnostics.propagateErrorType.code]);
  });

  it('infers type parameters against a union from what other members do not take, and never infers a union unprompted', () => {
    expect(
      runMain(
        'Int',
        [
          'const a = unwrapOr(5, 0)',
          'const b = unwrapOr(none, 9)',
          'const c: Int? = 12',
          'const d = unwrapOr(c, 0)',
          'const e = fromUnion(4)',
          'a + b + d + e',
        ].join('\n  '),
        [
          'fn unwrapOr<T>(x: T?, fallback: T) -> T: x ?? fallback',
          'fn fromUnion<T>(x: T | String) -> T:',
          '  match x:',
          '    case String: panic("str")',
          '    case v: v',
        ],
      ),
    ).toBe(30);

    expect(
      codesOf('fn onlyOpt<T>(x: T?) -> T: x ?? panic("none")', 'fn bad():', '  _ = onlyOpt(none)'),
    ).toEqual([checkerDiagnostics.cannotInfer.code]);

    expect(codesOf('fn badIf(c: Bool):', '  const x = if c: 1 else: "a"', '  _ = x')).toEqual([
      checkerDiagnostics.branchTypes.code,
    ]);

    expect(codesOf('fn badArray():', '  const xs = [1, "a"]', '  _ = xs')).toEqual([
      checkerDiagnostics.itemTypes.code,
    ]);
  });
});

describe('literal types (§4)', () => {
  it('gives `none` type `None` without needing an expected type', () => {
    expect(hoverCodeAt('fn f():', '  const x = no‸ne', '  _ = x')).toEqual(['None']);
    expect(runMain('Bool', 'const x = none\n  x == none')).toBe(true);
  });

  it('infers base types for literals unless a literal type or union holding one is expected', () => {
    expect(hoverCodeAt('fn f():', '  const s = "dra‸ft"', '  _ = s')).toEqual(['String']);
    expect(
      hoverCodeAt(
        'type Status = "draft" | "sent"',
        'fn f():',
        '  const s: "draft" = "dra‸ft"',
        '  _ = s',
      ),
    ).toEqual(['"draft"']);
  });

  it('fits a literal type or union of literals of one base into that base type, and never base into literal', () => {
    expect(
      runMain(
        'String',
        [
          'const s: Status = "draft"',
          'const n: -1 | 42 = -1',
          'const b: true = true',
          'const upper = s.toUpperCase() + "!"',
          'const sum = n + 10',
          '`${upper}:${sum}:${not b}`',
        ].join('\n  '),
        ["import toUpperCase from 'strings'", ...baseDecls],
      ),
    ).toBe('DRAFT!:9:false');

    expect(
      codesOf(
        ...baseDecls,
        'fn bad(name: String, num: Int):',
        '  const s1: Status = name',
        '  const s2: Status = "unknown"',
        '  const n1: 1 | 2 = num',
        '  const n2: 1 | 2 = 3',
        '  _ = (s1, s2, n1, n2)',
      ),
    ).toEqual([
      checkerDiagnostics.typeMismatch.code,
      checkerDiagnostics.typeMismatch.code,
      checkerDiagnostics.typeMismatch.code,
      checkerDiagnostics.typeMismatch.code,
    ]);
  });

  it('agrees on the base type when values of literal types of one base meet with no expected type', () => {
    expect(
      runMain(
        'String',
        [
          'const k1: "a" = "a"',
          'const k2: "b" = "b"',
          'const xs = [k1, k2]',
          'const branch = if true: k1 else: k2',
          'const comp = [for x in xs: k1]',
          '`${xs[0]}:${xs[1]}:${branch}:${comp.length()}`',
        ].join('\n  '),
      ),
    ).toBe('a:b:a:2');
    expect(
      hoverCodeAt(
        'fn f(c: Bool):',
        '  const k1: "a" = "a"',
        '  const k2: "b" = "b"',
        '  const br‸anch = if c: k1 else: k2',
        '  _ = branch',
      ),
    ).toEqual(['(variable) branch: String']);
  });

  it('allows `==` and `!=` when either operand fits the other type', () => {
    expect(
      runMain(
        'String',
        [
          'const s: Status = "draft"',
          'const name: String = "draft"',
          'const other: String = "archived"',
          'const one: 1 = 1',
          'const n: Int = 1',
          '`${s == name}:${s != other}:${name == s}:${one == n}`',
        ].join('\n  '),
        baseDecls,
      ),
    ).toBe('true:true:true:true');
  });

  it('parses `a < 1 > (b)` and `a < Int | String > (b)` as generic calls, and `(a < 1) > b` as a comparison', () => {
    expect(
      runMain(
        'String',
        ['const c1 = pick<1>(1)', 'const c2 = either<Int | String>("ok")', '`${c1}:${c2}`'].join(
          '\n  ',
        ),
        ['fn pick<T in 1 | 2>(x: T) -> Int: x', 'fn either<T>(x: T) -> String:', '  "called"'],
      ),
    ).toBe('1:called');
  });
});
