/**
 * End-to-end verification of every row in the 'What changes in behaviour' table of
 * docs/proposals/7-variant-calls.md: one test per row (rows 1–14), covering variants declared in
 * parentheses, called and named as values as functions are, taken apart by call patterns, and the
 * forms refused in their place, each refusal naming the form meant.
 */

import { describe, expect, it } from 'vitest';
import { mainGives } from '../stdlib/prelude/prelude.test-kit.ts';
import { stdProgramOf } from './binder/bind.test-kit.ts';
import { reported } from './checker/check.test-kit.ts';
import { checkerDiagnostics } from './checker/diagnostics/index.ts';
import { diagnosedAt } from './compile.test-kit.ts';
import { parserDiagnostics } from './parser/diagnostics.ts';
import { lines } from './parser/parse.test-kit.ts';

const verdict = lines(
  'enum Verdict:',
  '  Approved',
  '  Rejected(by: String, reason: String = "no reason given")',
);

/** The messages checking `text` as `main.ista` reports with `code`. */
function messagesOf(text: string, code: number): readonly string[] {
  const { diagnostics } = diagnosedAt(stdProgramOf({ 'main.ista': text }), 'main.ista');
  return diagnostics.filter((each) => each.code === code).map(({ message }) => message);
}

describe('proposal 7 behaviour table: row by row', () => {
  it('row 1: a variant declares its fields in parentheses, a default among them', () => {
    const decls = 'enum V { R(by: String, reason: String = "") }';
    expect(mainGives('String', 'match V.R("x"):\n  case R(by, reason): by + reason', decls)).toBe(
      'x',
    );
  });

  it('row 2: braces declaring a variant are refused, naming its parenthesized form', () => {
    const text = lines('enum V { R { by: String } }', 'async fn main(): 0');
    expect(messagesOf(text, parserDiagnostics.bracedVariant.code)).toEqual([
      expect.stringContaining('R(by: String)'),
    ]);
  });

  it("row 3: a variant's field after a defaulted one needs a default, as a parameter does", () => {
    const text = lines('enum V { R(a: Int = 0, b: Int) }', 'async fn main(): 0');
    expect(reported(text).codes).toEqual([checkerDiagnostics.defaultMissing.code]);
  });

  it('row 4: `Ok(v)` builds `Ok` with `value` = `v`', () => {
    const decls = 'fn f(v: Int) -> Result<Int>: Ok(v)';
    expect(mainGives('Int', 'match f(4):\n  case Ok{value}: value\n  case _: 0', decls)).toBe(4);
  });

  it("row 5: a call leaves a variant's defaulted field to its default", () => {
    const body =
      'match Verdict.Rejected(by: "x"):\n  case Rejected(_, reason): reason\n  case _: ""';
    expect(mainGives('String', body, verdict)).toBe('no reason given');
  });

  it("row 6: a call's arguments past the fixed fields go into the rest field", () => {
    const decls = lines('enum Node:', '  Leaf', '  Group(title: String, ...children: Array<Node>)');
    const body =
      'match Node.Group("t", Node.Leaf, Node.Leaf):\n  case Group{children}: children.length()\n  case _: 0';
    expect(mainGives('Int', body, decls)).toBe(2);
  });

  it('row 7: a variant named as a value is a function, `vs.map(Result.Ok)`', () => {
    const body = 'const rs: Array<Result<Int>> = [1, 2].map(Result.Ok)\nrs == [Ok(1), Ok(2)]';
    expect(mainGives('Bool', body)).toBe(true);
  });

  it("row 8: a bare variant is a function value where the expected function's result is its enum", () => {
    const body = 'const f: fn(Int) -> Result<Int> = Ok\nf(5) == Ok(5)';
    expect(mainGives('Bool', body)).toBe(true);
  });

  it('row 9: a bare variant with no enum to find it in is refused, naming it qualified', () => {
    const text = lines(
      'fn f(xs: Array<Int>) -> Int:',
      '  _ = xs.map(Ok)',
      '  0',
      'async fn main(): 0',
    );
    expect(messagesOf(text, checkerDiagnostics.bareVariant.code)).toEqual([
      expect.stringContaining('Result.Ok'),
    ]);
  });

  it('row 10: `case Ok(v)` binds `v` to the value', () => {
    const body = 'const r: Result<Int> = Ok(7)\nmatch r:\n  case Ok(v): v\n  case Err(_): 0';
    expect(mainGives('Int', body)).toBe(7);
  });

  it("row 11: `as` binds the enum, so a variant's field doesn't read through it", () => {
    const text = lines(
      verdict,
      'fn f(v: Verdict) -> String:',
      '  match v:',
      '    case Rejected(...) as r: r.by',
      '    case _: ""',
      'async fn main(): 0',
    );
    expect(reported(text).spanTexts).toEqual(['by']);
  });

  it("row 12: a variant's field given by position in braces is refused, naming the call", () => {
    const text = lines(
      'fn f(v: Int) -> Result<Int>: Ok{(v)}',
      'fn g() -> Result<Int>: Ok{42}',
      'async fn main(): 0',
    );
    expect(messagesOf(text, checkerDiagnostics.variantByPosition.code)).toEqual([
      expect.stringContaining("'Ok(v)'"),
      expect.stringContaining("'Ok(42)'"),
    ]);
  });

  it('row 13: `Ok{v}` is still refused, now naming `Ok(v)`', () => {
    const text = lines('fn f(v: Int) -> Result<Int>: Ok{v}', 'async fn main(): 0');
    expect(messagesOf(text, checkerDiagnostics.variantByPosition.code)).toEqual([
      expect.stringContaining("'Ok(v)'"),
    ]);
  });

  it('row 14: `Expired()` is `Expired`', () => {
    const decls = 'enum Decision { Approved, Expired }';
    expect(mainGives('Bool', 'Decision.Expired() == Decision.Expired', decls)).toBe(true);
  });
});
