/**
 * Computed types in the tools (docs/proposals/4-computed-types.md; spec §2): the formatter prints
 * every new form so that formatting again changes nothing and the tree stays the one written, and
 * never throws on soup or broken text holding them; hover shows what a computed type is,
 * go-to-definition follows `.Data` to its declaration, completion after `Type.` offers its
 * associated types; and `infer` and `keyof`, being contextual, still name things.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse } from '../../src/compiler/parser/parse.ts';
import { scan } from '../../src/compiler/scanner/scan.ts';
import { formatText, formatTree } from '../../src/formatter/format.ts';
import { createSourceText } from '../../src/foundation/text/source-text.ts';
import { brokenText } from '../broken.ts';
import { soupOf } from '../soup.ts';
import { codesOf, completionNamesAt, hoverCodeAt } from '../written-types.test-kit.ts';
import { declaredPlacesAt, formatRoundTrip } from './computed.test-kit.ts';

const computedSource = [
  'trait FormNode:',
  '  type Data is Sendable',
  '  fn validate(self: Self, data: Self.Data) -> Array<String>',
  '',
  'struct Field<T>:',
  '  value: T?',
  '  type Data = T',
  '',
  'type DataOf<D> = match D:',
  '  case Field<infer T is Sendable>: T',
  '  case struct { title: String, [_] is FormNode }: { [F in keyof D]: DataOf<D[F]> }',
  '  case _: Never',
  '',
  'fn copyAll<S is struct { title: String, [_]: Int }>(s: S) -> String:',
  '  const struct{title, ...rest} = s',
  '  const clone = struct{title, for k, v in ...rest: [k]: v}',
  '  for k, v in ...clone:',
  '    s[k] == v',
  '  [for k, _ in ...clone: k].join(",")',
  '',
].join('\n');

/** The text formatted, then formatted again; undefined twice where it has syntax errors. */
function formattedTwice(text: string): readonly [string | undefined, string | undefined] {
  const source = createSourceText('soup.ista', text);
  const once = formatTree(parse(source, scan(source)));
  return [once, once === undefined ? undefined : formatText(once)];
}

describe('the formatter', () => {
  it('prints every computed form as written, a second pass changing nothing', () => {
    const { formatted, twice, dumpBefore, dumpAfter } = formatRoundTrip(computedSource);
    expect(formatted).toBeDefined();
    expect(twice).toBe(formatted);
    expect(dumpAfter).toBe(dumpBefore);
  });

  it('never throws on soup or broken text holding the computed forms', () => {
    const fragments = [
      ...['type', 'Data', '=', 'match', 'case', 'infer', 'keyof', 'struct', '[_]', 'is', 'in'],
      ...['...', 'for', '[F in keyof S]: S[F].Data', 'const struct{title, ...rest} = form'],
      ...['s[k] = v', '{', '}', '[', ']', ':', ';', '.'],
    ];
    const formatsStably = (text: string) => {
      const [once, twice] = formattedTwice(text);
      expect(twice).toBe(once);
    };
    fc.assert(
      fc.property(soupOf(fragments, [' ', '\n', '\n  ', '\n    ', ''], 18), formatsStably),
      { numRuns: 40 },
    );
    fc.assert(fc.property(brokenText([computedSource]), formatsStably), { numRuns: 30 });
  });
});

describe('the language service', () => {
  const declarations = [
    'struct Field<T> { value: T?, type Data = T }',
    'struct Settings { retries: Int, region: String }',
    'type DataOf<D> = match D:',
    '  case Field<infer T>: T',
    '  case _: Never',
  ];

  it('hovers a computed type as what it is', () => {
    const hover = (...lines: readonly string[]) => hoverCodeAt(...declarations, ...lines);
    expect(hover('fn f(x: Field<Int>.Data):', '  const ‸a = x', '  _ = a')).toEqual([
      '(variable) a: Field<Int>.Data = Int',
    ]);
    expect(hover('fn f(k: keyof Settings):', '  const ‸a = k', '  _ = a')).toEqual([
      '(variable) a: keyof Settings = "region" | "retries"',
    ]);
    expect(hover('fn f(d: DataOf<Field<String>>):', '  const ‸a = d', '  _ = a')).toEqual([
      '(variable) a: DataOf<Field<String>> = String',
    ]);
    expect(
      hover('fn f(s: Settings):', '  const struct{retries, ...re‸st} = s', '  _ = (retries, rest)'),
    ).toEqual(['(variable) rest: struct { region: String }']);
    expect(
      hover(
        'fn f<S is struct { id: Int }>(s: S):',
        '  const struct{id, ...re‸st} = s',
        '  _ = (id, rest)',
      ),
    ).toEqual(['(variable) rest: { [F in keyof S except "id"]: S[F] }']);
  });

  it('hovers an opaque type with the bounds it is known by', () => {
    const traits = [
      'trait Shown:',
      '  fn shown(self: Self) -> String',
      'trait Holds:',
      '  type Data is Shown & Encodable',
      'import Encodable from "json"',
    ];
    expect(
      hoverCodeAt(...traits, 'fn f<H is Holds>(d: H.Data):', '  const ‸a = d', '  _ = a'),
    ).toEqual(['(variable) a: H.Data is Shown & Encodable']);
    expect(hoverCodeAt(...traits, 'fn f<H is Holds>(h: H):', '  const ‸a = h', '  _ = a')).toEqual([
      '(variable) a: H is Holds',
    ]);
    expect(
      hoverCodeAt(
        ...traits,
        'fn f<S is struct { [_] is Shown }>(s: S):',
        '  for _, ‸v in ...s:',
        '    _ = v',
      ),
    ).toEqual(['(variable) v: S[keyof S] is Shown']);
  });

  it('follows `.Data` to its declaration and offers associated types after `Type.`', () => {
    const field = ['struct Field<T>:', '  value: T?', '  type Data = T'];
    expect(declaredPlacesAt(...field, 'fn f(x: Field<Int>.Da‸ta) -> Int: x')).toEqual(['main:36']);
    expect(completionNamesAt(...field, 'fn f(x: Field<Int>.‸) -> Int: 0')).toContain('Data');
  });

  it('follows `R.Data` and `Self.Data` to every trait requirement declaring it', () => {
    const traits = [
      'trait Fa:',
      '  type Data',
      'trait Gn:',
      '  type Data',
      '  fn g(self: Self, d: Self.Da‸ta)',
    ];
    expect(declaredPlacesAt(...traits)).toEqual(['main:39']);
    const both = ['trait Fa:', '  type Data', 'trait Gn:', '  type Data'];
    expect(declaredPlacesAt(...both, 'fn f<R is Fa & Gn>(x: R.Da‸ta): ()')).toEqual([
      'main:17',
      'main:39',
    ]);
  });

  it('shows the field a key names, and the type variables computed types bind', () => {
    const settings = ['struct Settings { retries: Int, region: String }'];
    expect(hoverCodeAt(...settings, 'fn f(x: Settings["retri‸es"]) -> Int: x')).toEqual([
      '(field) retries: Int',
    ]);
    expect(hoverCodeAt(...settings, 'fn f(s: Settings) -> String: s["regi‸on"]')).toEqual([
      '(field) region: String',
    ]);
    const match = ['struct Field<T> { value: T }', 'type D<X> = match X:'];
    expect(hoverCodeAt(...match, '  case Field<infer T>: T‸', '  case _: Never')).toEqual([
      '(type) T',
    ]);
    expect(declaredPlacesAt(...match, '  case Field<infer T>: T‸', '  case _: Never')).toEqual([
      'main:69',
    ]);
    expect(
      declaredPlacesAt(...settings, 'fn f(x: { [K in keyof Settings]: Array<K‸> }) -> Int: 0'),
    ).toEqual(['main:60']);
  });

  it('offers associated types, the keys a struct is indexed by, and `type` in bodies', () => {
    const decls = [
      'trait FormNode:',
      '  type Data',
      'struct Settings { retries: Int, region: String }',
    ];
    expect(completionNamesAt(...decls, 'fn f<T is FormNode>(x: T.‸) -> Int: 0')).toEqual(['Data']);
    expect(
      completionNamesAt(...decls, 'fn f(s: Settings) -> Int:', '  _ = s[‸]', '  0').filter((name) =>
        name.startsWith('"'),
      ),
    ).toEqual(['"region"', '"retries"']);
    const inQuotes = (text: string) =>
      completionNamesAt(...decls, 'fn f(s: Settings) -> Int:', `  _ = s[${text}]`, '  0');
    expect(inQuotes('"‸"')).toEqual(['region', 'retries']);
    expect(inQuotes('"re‸"')).toEqual(['region', 'retries']);
    expect(completionNamesAt('fn f(x: "a" | "b") -> Int: 0', 'const y = f("‸")')).toEqual([
      'a',
      'b',
    ]);
    expect(completionNamesAt('const greeting = "hel‸lo"')).toEqual([]);
    expect(completionNamesAt('fn f(x: ‸) -> Int: 0')).not.toContain('infer');
    const typeMatch = ['struct Field<T> { value: T }', 'type D<X> = match X:'];
    expect(completionNamesAt(...typeMatch, '  case Field<‸>: Int', '  case _: Never')).toContain(
      'infer',
    );
    expect(completionNamesAt(...typeMatch, '  case Field<infer T>: Array<‸>')).not.toContain(
      'infer',
    );
    expect(completionNamesAt('struct A:', '  x: Int', '  ‸')).toEqual(['type']);
    expect(completionNamesAt('enum E:', '  A', '  ‸')).toEqual(['type']);
    expect(completionNamesAt('trait T:', '  fn f(self: Self) -> Int', '  ‸')).toEqual([
      'type',
      'fn',
      'live',
      'ista',
      'async',
    ]);
  });

  it('still names things `infer` and `keyof`', () => {
    expect(
      codesOf(
        'struct Words { infer: Int, keyof: String }',
        'fn infer(keyof: Int) -> Int: keyof + 1',
        'fn useWords() -> Int:',
        '  const w = Words{infer: 2, keyof: "k"}',
        '  infer(w.infer)',
      ),
    ).toEqual([]);
  });
});
