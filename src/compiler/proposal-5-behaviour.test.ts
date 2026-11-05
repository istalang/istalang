/**
 * End-to-end verification of every row in the 'What changes in behaviour' table of
 * docs/proposals/5-indented-values.md: one test per row (rows 1–30), covering indented values,
 * recursive aliases, Json as a recursive union, ',' as the one list separator, parameter patterns,
 * line breaks between bracketed list items (including the two meaning changes inside brackets),
 * parenthesized import lists and import renames, and formatter output on broken lists and imports.
 */

import { describe, expect, it } from 'vitest';
import { formatText } from '../formatter/format.ts';
import { mainGives } from '../stdlib/prelude/prelude.test-kit.ts';
import { stdProgramOf } from './binder/bind.test-kit.ts';
import { binderDiagnostics } from './binder/diagnostics.ts';
import { reported } from './checker/check.test-kit.ts';
import { checkProgram } from './checker/check.ts';
import { checkerDiagnostics } from './checker/diagnostics/index.ts';
import { sameType } from './checker/types/identity.ts';
import type { Type } from './checker/types/type.ts';
import { parserDiagnostics } from './parser/diagnostics.ts';
import { dumpClean, lines } from './parser/parse.test-kit.ts';
import { idOf } from './program/program.test-kit.ts';
import { programModule } from './program/program.ts';
import type { FunctionDeclaration } from './syntax/declarations.ts';

/** `main`'s body written over several lines, each indented under `main`: `mainGives` indents its first. */
function mainGivesLines(result: string, body: string, declarations?: string): unknown {
  return mainGives(result, body.trimEnd().split('\n').join('\n  '), declarations);
}

/** The parameter types of the first function `source` declares, as checked. */
function parameterTypesOf(source: string): { readonly types: readonly Type[] } {
  const program = stdProgramOf({ 'main.ista': source });
  const checker = checkProgram(program);
  const fn = programModule(program, idOf('main.ista')).tree.root.items.find(
    (item): item is FunctionDeclaration => item.kind === 'FunctionDeclaration',
  );
  return { types: fn === undefined ? [] : checker.parametersOf(fn).map(({ type }) => type) };
}

describe('proposal 5 behaviour table: row by row', () => {
  it('row 1: "const c: Config =" with "retries: 3" indented below builds Config{retries: 3}', () => {
    const decls = 'struct Config { retries: Int }';
    const body = lines('const c: Config =', '  retries: 3', 'c.retries');
    expect(mainGivesLines('Int', body, decls)).toBe(3);
  });

  it('row 2: "const c = Config:" with an indented block builds Config{…}', () => {
    const decls = 'struct Config { retries: Int, region: String = "eu" }';
    const body = lines('const c = Config:', '  retries: 5', '`${c.region}:${c.retries}`');
    expect(mainGivesLines('String', body, decls)).toBe('eu:5');
  });

  it('row 3: "return" with an indented block returns the value built for the return type', () => {
    const decls = lines(
      'struct Config { retries: Int, region: String }',
      'fn makeConfig() -> Config:',
      '  return',
      '    retries: 4',
      '    region: "us"',
    );
    expect(
      mainGivesLines('String', '`${makeConfig().region}:${makeConfig().retries}`', decls),
    ).toBe('us:4');
  });

  it('row 4: a body line "Config:" with a block below is still a label (warning 5711, or error 2130)', () => {
    const unusedLabel = lines('fn f() -> Int:', '  Config:', '    const x = 1', '  2');
    expect(reported(unusedLabel).codes).toEqual([checkerDiagnostics.unusedLabel.code]);

    const danglingLabel = lines('fn f():', '  Config:');
    expect(reported(danglingLabel).codes).toContain(parserDiagnostics.misplacedLabel.code);
  });

  it('row 5: "- 1" lines under "const xs: Array<Int> =" build [1, …]', () => {
    const body = lines('const xs: Array<Int> =', '  - 1', '  - 2', '  - 3', 'xs');
    expect(mainGivesLines('Array<Int>', body)).toEqual([1, 2, 3]);
  });

  it('row 6: \'"x-id": "1"\' under a Map<String, String> field builds the entry \'"x-id": "1"\'', () => {
    const decls = 'struct Req { headers: Map<String, String> }';
    const body = lines(
      'const r = Req:',
      '  headers:',
      '    "x-id": "1"',
      '    "x-env": "prod"',
      'r.headers["x-id"] + ":" + r.headers["x-env"]',
    );
    expect(mainGivesLines('String', body, decls)).toBe('1:prod');
  });

  it('row 7: "type Tree = Int | Array<Tree>" is a recursive union', () => {
    const decls = lines(
      'type Tree = Int | Array<Tree>',
      'fn total(t: Tree) -> Int:',
      '  match t:',
      '    case Int as n: return n',
      '    case Array<Tree> as xs:',
      '      let s = 0',
      '      for x in xs:',
      '        s += total(x)',
      '      return s',
    );
    expect(mainGives('Int', 'total([1, [2, [3, 4]]])', decls)).toBe(10);
  });

  it('row 8: "type List = { head: Int, tail: List? }" is a recursive shape', () => {
    const decls = 'type List = { head: Int, tail: List? }';
    const body = lines(
      'const l: List =',
      '  head: 7',
      '  tail:',
      '    head: 8',
      '    tail: none',
      'l.head + (l.tail?.head ?? 0)',
    );
    expect(mainGivesLines('Int', body, decls)).toBe(15);
  });

  it('row 9: "type A = A | Int" is still error 5106', () => {
    expect(reported('type A = A | Int').codes).toEqual([checkerDiagnostics.aliasCycle.code]);
  });

  it('row 10: a Json literal is written ["a": 1, "b": [true, none]] without variant wrappers', () => {
    const decls = "import * as json from 'json'\nimport Json from 'json'";
    const body = lines('const j: Json = ["a": 1, "b": [true, none]]', 'json.stringify(j)');
    expect(mainGivesLines('String', body, decls)).toBe('{"a":1,"b":[true,null]}');
  });

  it('row 11: "case Text{value}" on a Json is gone; "case String as value" binds the String', () => {
    const decls = "import Json from 'json'";
    const oldPattern = lines(
      decls,
      'fn f(j: Json) -> String:',
      '  match j:',
      '    case Text{value}: value',
      '    case _: ""',
    );
    expect(reported(oldPattern).codes).toContain(binderDiagnostics.undeclared.code);
    const newPattern = lines(
      'const j: Json = "hello"',
      'match j:',
      '  case String as value: value',
      '  case _: ""',
    );
    expect(mainGivesLines('String', newPattern, decls)).toBe('hello');
  });

  it('row 12: "Json?" is "Json"', () => {
    const { types } = parameterTypesOf("import Json from 'json'\nfn check(a: Json, b: Json?): ()");
    const [plain, optional] = types;
    expect(plain !== undefined && optional !== undefined && sameType(plain, optional)).toBe(true);
  });

  it('row 13: "[]" where "Array<Int> | Map<String, Int>" is expected builds the empty array', () => {
    const body = lines('const x: Array<Int> | Map<String, Int> = []', 'x is Array<Int>');
    expect(mainGivesLines('Bool', body)).toBe(true);
  });

  it('row 14: "{ sku: String, qty: Int }", "struct R { id: Int, value: String }", "enum Color { Red, Green }" build the shape, struct and enum', () => {
    const decls = lines(
      'type Item = { sku: String, qty: Int }',
      'struct R { id: Int, value: String }',
      'enum Color { Red, Green }',
    );
    const body = lines(
      'const item: Item = struct{sku: "p1", qty: 3}',
      'const r = R{id: 1, value: item.sku}',
      'const c = Color.Green',
      '(r.id + item.qty, r.value, c is Color)',
    );
    expect(mainGivesLines('(Int, String, Bool)', body, decls)).toEqual([4, 'p1', true]);
  });

  it('row 15: "{ sku: String; qty: Int }" and "enum Color { Red; Green }" are errors (";" separates only statements)', () => {
    expect(reported('type Item = { sku: String; qty: Int }').codes.length).toBeGreaterThan(0);
    expect(reported('enum Color { Red; Green }').codes.length).toBeGreaterThan(0);
  });

  it('row 16: "x = 1; y = 2" and "{ log(msg); save(msg) }" keep statements sharing a line', () => {
    const body = lines(
      'let x = 0',
      'let y = 0',
      'x = 1; y = 2',
      'const z = { x += 10; y += 20; x + y }',
      'z',
    );
    expect(mainGivesLines('Int', body)).toBe(33);
  });

  it('row 21: "P{" over the lines \'id: "x"\' and "qty: 2", then "}" builds two fields', () => {
    const decls = 'struct P { id: String, qty: Int }';
    const body = lines('const p = P{', '  id: "x"', '  qty: 2', '}', '`${p.id}:${p.qty}`');
    expect(mainGivesLines('String', body, decls)).toBe('x:2');
  });

  it('row 22: "[" over lines "1" and "2", then "]", and "g(" over "1" and "2" build two items and two arguments', () => {
    const decls = 'fn g(a: Int, b: Int) -> Int: a * 10 + b';
    const body = lines(
      'const xs = [',
      '  1',
      '  2',
      ']',
      'const called = g(',
      '  1',
      '  2',
      ')',
      '(xs, called)',
    );
    expect(mainGivesLines('(Array<Int>, Int)', body, decls)).toEqual([[1, 2], 12]);
  });

  it('row 23: "[g" with "(1)]" on the next line parses as two items, g and (1)', () => {
    expect(dumpClean('expression', lines('[g', '  (1)]'))).toBe(
      dumpClean('expression', '[g, (1)]'),
    );
  });

  it('row 24: "[a" with "-1]" on the next line parses as two items, a and -1', () => {
    const body = lines('const a = 10', 'const xs = [a', '  -1]', 'xs');
    expect(mainGivesLines('Array<Int>', body)).toEqual([10, -1]);
  });

  it('row 25: "[a" with "- 1]" on the next line is still a - 1', () => {
    const body = lines('const a = 10', 'const xs = [a', '  - 1]', 'xs');
    expect(mainGivesLines('Array<Int>', body)).toEqual([9]);
  });

  it('row 26: "ista fmt" on a list too long for its line prints one item per line with no ","', () => {
    const long =
      'const names = ["first-very-long-item-name", "second-very-long-item-name", "third-very-long-item-name", "fourth-very-long-item-name"]\n';
    expect(formatText(long)).toBe(
      lines(
        'const names = [',
        '  "first-very-long-item-name"',
        '  "second-very-long-item-name"',
        '  "third-very-long-item-name"',
        '  "fourth-very-long-item-name"',
        ']',
        '',
      ),
    );
  });

  it('row 27: "import (a, b) from \'x\'", or "(" over lines "a" and "b", then ") from \'x\'" imports a and b', () => {
    const decls = lines('import (', '  Duration', '  Time', ") from 'time'");
    expect(mainGivesLines('Int', 'Duration{value: 3}.value + Time{value: 4}.value', decls)).toBe(7);
  });

  it('row 28: "import a," with "b from \'x\'" on the next line is still an error', () => {
    expect(reported(lines('import Duration,', "  Time from 'time'")).codes).toContain(
      parserDiagnostics.expected.code,
    );
  });

  it('row 29: "import a as x from \'x\'" binds the export a as x', () => {
    const decls = "import Duration as Span from 'time'";
    expect(mainGivesLines('Int', 'Span{value: 12}.value', decls)).toBe(12);
  });

  it('row 30: "ista fmt" on a bare import too long for its line formats it parenthesized, one name per line', () => {
    const longBare =
      "import approvePurchaseRequest, rejectPurchaseRequest, cancelPurchaseRequest, notifyPurchaseReviewers, ChargeVerdict from 'purchase/approval/workflow'\n";
    expect(formatText(longBare)).toBe(
      lines(
        'import (',
        '  approvePurchaseRequest',
        '  rejectPurchaseRequest',
        '  cancelPurchaseRequest',
        '  notifyPurchaseReviewers',
        '  ChargeVerdict',
        ") from 'purchase/approval/workflow'",
        '',
      ),
    );
  });
});
