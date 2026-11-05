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
import { createSourceText } from '../../src/text/source-text.ts';
import { brokenText } from '../broken.ts';
import { soupOf } from '../soup.ts';
import {
  codesOf,
  completionNamesAt,
  declaredPlacesAt,
  formatRoundTrip,
  hoverCodeAt,
} from './computed.test-kit.ts';

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
  '  case struct { title: String; [_] is FormNode }: { [F in keyof D]: DataOf<D[F]> }',
  '  case _: Never',
  '',
  'fn copyAll<S is struct { title: String; [_]: Int }>(s: S) -> String:',
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
    'struct Field<T> { value: T?; type Data = T }',
    'struct Settings { retries: Int; region: String }',
    'type DataOf<D> = match D:',
    '  case Field<infer T>: T',
    '  case _: Never',
  ];

  it('hovers a computed type as what it is', () => {
    const hover = (...lines: readonly string[]) => hoverCodeAt(...declarations, ...lines);
    expect(hover('fn f(x: Field<Int>.Data):', '  const ‸a = x', '  _ = a')).toEqual([
      '(variable) a: Field<Int>.Data',
    ]);
    expect(hover('fn f(k: keyof Settings):', '  const ‸a = k', '  _ = a')).toEqual([
      '(variable) a: "region" | "retries"',
    ]);
    expect(hover('fn f(d: DataOf<Field<String>>):', '  const ‸a = d', '  _ = a')).toEqual([
      '(variable) a: DataOf<Field<String>>',
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

  it('follows `.Data` to its declaration and offers associated types after `Type.`', () => {
    const field = ['struct Field<T>:', '  value: T?', '  type Data = T'];
    expect(declaredPlacesAt(...field, 'fn f(x: Field<Int>.Da‸ta) -> Int: x')).toEqual(['main:36']);
    expect(completionNamesAt(...field, 'fn f(x: Field<Int>.‸) -> Int: 0')).toContain('Data');
  });

  it('still names things `infer` and `keyof`', () => {
    expect(
      codesOf(
        'struct Words { infer: Int; keyof: String }',
        'fn infer(keyof: Int) -> Int: keyof + 1',
        'fn useWords() -> Int:',
        '  const w = Words{infer: 2, keyof: "k"}',
        '  infer(w.infer)',
      ),
    ).toEqual([]);
  });
});
