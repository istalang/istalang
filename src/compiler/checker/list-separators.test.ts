/**
 * Checking comma-separated declarations (proposal 5 §4): structs, defaults, associated types,
 * enums, variants, traits, struct constraints and mapped struct types written with ',' check and
 * run cleanly.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing, reportedOnce } from '../../foundation/diagnostics/diagnostic.test-kit.ts';
import { mainGives } from '../../stdlib/prelude/prelude.test-kit.ts';
import { lines } from '../parser/parse.test-kit.ts';
import { reported } from './check.test-kit.ts';
import { checkerDiagnostics } from './diagnostics/index.ts';

describe('comma-separated declarations, constraints and mapped types (§4)', () => {
  it('checks and runs all declaration and type forms from §4 written with ","', () => {
    const decls = lines(
      'type Item = { sku: String, qty: Int }',
      'struct Req { id: Int, value: String }',
      'struct Retry { times: Int = 3, backoff = times * 2 }',
      'struct Cell<T> { value: T, type Data = Array<T> }',
      'enum Color { Red, Green, Blue }',
      'enum Decision { Rejected { by: String, reason: String }, Approved }',
      'trait Shape { fn area(self: Self) -> Int, type Measure }',
      'struct Box { w: Int, h: Int, type Measure = Int }',
      'fn area(self: Box) -> Int: self.w * self.h',
      'fn describe<S is struct { title: String, [_] is Stringable }>(s: S) -> String: s.title',
      'type Mapped<S is struct> = { id: String, [F in keyof S]: S[F] }',
    );
    const body = lines(
      'const item: Item = struct{sku: "a", qty: 2}',
      'const req = Req{id: 1, value: "ok"}',
      'const retry = Retry{}',
      'const xs: Cell<Int>.Data = [retry.backoff, item.qty]',
      'const b = Box{w: 3, h: 4}',
      'const m: Mapped<{ count: Int }> = struct{id: req.value, count: b.area()}',
      'const t = describe(struct{title: "form", note: 10})',
      '`${t}:${m.id}:${m.count}:${xs[0]}:${Color.Green is Color}:${Decision.Approved is Decision}`',
    );
    expect(reported(`${decls}\nfn check(): ()`)).toEqual(reportedNothing);
    expect(mainGives('String', body, decls)).toBe('form:ok:12:6:true:true');
  });
});

describe('empty [] and [:] literals against union types (§3)', () => {
  it('selects Array<T> for [] and Map<K, V> for [:] when a union holds both', () => {
    const body = lines(
      'const a: Array<Int> | Map<String, Int> = []',
      'const m: Array<Int> | Map<String, Int> = [:]',
      '(a is Array<Int>, m is Map<String, Int>)',
    );
    expect(mainGives('(Bool, Bool)', body)).toEqual([true, true]);
  });

  it('still reports 5300 when [] or [:] has no expected type or fits multiple array/map members', () => {
    expect(reported('fn f():\n  const xs = []')).toEqual(
      reportedOnce(checkerDiagnostics.emptyCollection.code, '[]'),
    );
    expect(reported('fn f():\n  const m = [:]')).toEqual(
      reportedOnce(checkerDiagnostics.emptyCollection.code, '[:]'),
    );
    expect(reported('fn f():\n  const xs: Array<Int> | Array<String> = []').codes).toContain(
      checkerDiagnostics.emptyCollection.code,
    );
    expect(
      reported('fn f():\n  const m: Map<String, Int> | Map<String, Bool> = [:]').codes,
    ).toContain(checkerDiagnostics.emptyCollection.code);
  });
});
