/**
 * Rest in struct patterns (docs/proposals/4-computed-types.md §7; spec §3.11, §3.15): `...rest`,
 * last in a struct pattern, binds a copy of the fields no other item names, as the shape of those
 * fields, or, over a type parameter with a struct constraint, an opaque struct field loops,
 * comprehensions and keys reach. It can't fail, so declaration targets take it as `match` and
 * `is` do. Properties hold the commute law: a generic split instantiated, the split over the
 * concrete struct, and the fields written out by hand agree.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatText } from '../../src/formatter/format.ts';
import { codesOf, runMain } from '../written-types.test-kit.ts';
import { type GeneratedField, generatedFieldsArbitrary } from './computed.test-kit.ts';

const formDeclarations = [
  'trait FormNode:',
  '  type Data',
  '  fn validate(self: Self, data: Self.Data) -> Array<String>',
  'struct Field<T>:',
  '  value: T?',
  '  type Data = T',
  'fn validate<T>(self: Field<T>, data: T) -> Array<String>:',
  '  if self.value == none: ["missing"] else: []',
];

/** Runs `lines` as `main`'s body, giving a String. */
async function runText(
  lines: readonly string[],
  declarations: readonly string[],
): Promise<unknown> {
  return await runMain('String', lines.join('\n  '), declarations);
}

describe('a rest over a struct whose fields are known', () => {
  it('binds the shape of the fields left, in targets, cases and `is`, in name order', async () => {
    const declarations = [
      'struct Page { views: Int, title: String, draft: Bool }',
      'fn summarize(p: Page) -> String:',
      '  match p:',
      '    case Page{title == "", ...rest}: `untitled:${rest.views}:${rest.draft}`',
      '    case Page{title, ...rest} if p is Page{views == 0, ..._}: `zero:${title}:${rest.draft}`',
      '    case Page{title, ...rest}: `${title}:${rest.views}`',
      'fn keys(p: Page) -> String:',
      '  const struct{views, ...rest} = p',
      '  [for k, v in ...rest: `${k}=${v}`].join(",")',
      'fn twice(p: Page) -> String:',
      '  const struct{title, ...first} = p',
      '  const struct{views, ...second} = first',
      '  `${title}/${views}/${second.draft}`',
    ];
    const lines = [
      'const a = summarize(Page{title: "", views: 10, draft: true})',
      'const b = summarize(Page{title: "Home", views: 0, draft: false})',
      'const c = summarize(Page{title: "Docs", views: 5, draft: false})',
      'const d = keys(Page{title: "T", views: 1, draft: true})',
      'const e = twice(Page{title: "T", views: 2, draft: false})',
      '`${a}|${b}|${c}|${d}|${e}`',
    ];
    expect(await runText(lines, declarations)).toBe(
      'untitled:10:true|zero:Home:false|Docs:5|draft=true,title=T|T/2/false',
    );
  });

  it('is a shape: equal to the literal of its fields, sent as JSON, and taken by a loop target', async () => {
    const declarations = [
      "import * as json from 'json'",
      'struct Settings { retries: Int, region: String, debug: Bool }',
      'const struct{debug, ...base} = Settings{retries: 2, region: "eu", debug: true}',
      'fn total(xs: Array<Settings>) -> Int:',
      '  let n = 0',
      '  for struct{retries, ..._} in xs:',
      '    n += retries',
      '  n',
    ];
    const lines = [
      'const same = base == struct{region: "eu", retries: 2}',
      'const s = Settings{retries: 1, region: "us", debug: false}',
      'const copy: { region: String, retries: Int } = struct{for k, v in ...base: [k]: v}',
      '`${same}|${json.stringify(base)}|${total([s, s])}|${copy.region}|${debug}`',
    ];
    expect(await runText(lines, declarations)).toBe('true|{"region":"eu","retries":2}|2|eu|true');
  });
});

describe('a rest over a type parameter with a struct constraint', () => {
  it('takes the named fields by name and loops, comprehends and keys over the rest', async () => {
    const declarations = [
      ...formDeclarations,
      'fn fieldNames<S is struct { title: String, [_] is FormNode }>(form: S) -> Array<String>:',
      '  const struct{title, ...rest} = form',
      '  [for field, _ in ...rest: `${title}.${field}`]',
      'fn checked<S is struct { title: String, [_] is FormNode }>(form: S) -> Int:',
      '  match form:',
      '    case struct{title == "", ...rest}: -1',
      '    case struct{...rest}: [for k, _ in ...rest: k].length()',
      'fn viaKeys<S is struct { id: Int, [_]: Int }>(s: S) -> Int:',
      '  const struct{id, ...rest} = s',
      '  let sum = id',
      '  for k, _ in ...rest:',
      '    sum += s[k]',
      '  sum',
    ];
    const lines = [
      'const form = struct{title: "cfg", b: Field<Int>{value: 1}, a: Field<String>{value: "x"}}',
      'const names = fieldNames(form)',
      'const count = checked(form)',
      'const sum = viaKeys(struct{id: 1, x: 10, y: 100})',
      '`${names.join(",")}|${count}|${sum}`',
    ];
    expect(await runText(lines, declarations)).toBe('cfg.a,cfg.b|3|111');
  });

  it('reaches no field its constraint doesn’t name, and gives no shape without an expected type', () => {
    const constrained = 'fn f<S is struct { title: String }>(s: S) -> String:';
    expect(codesOf(constrained, '  const struct{title, other} = s', '  title')).toEqual([5013]);
    expect(
      codesOf(
        constrained,
        '  const struct{title, ...rest} = s',
        '  const copy = struct{for k, v in ...rest: [k]: v}',
        '  title',
      ),
    ).toEqual([5167]);
  });

  it('guards on a field taken twice, as a known struct does', () => {
    const constrained = 'fn f<S is struct { title: String }>(s: S) -> String:';
    const twice = (subject: string) =>
      codesOf(
        subject,
        '  match s:',
        '    case struct{title as t, title as u}: t',
        '    case _: "other"',
      );
    expect(twice(constrained)).toEqual(twice('fn f(s: { title: String }) -> String:'));
  });
});

describe('where a rest stands', () => {
  it('is the last item and the only one, and no variant is taken apart in braces to take one', () => {
    const page = 'struct Page { title: String, body: String }';
    expect(
      codesOf(page, 'fn f(p: Page) -> String:', '  const Page{...rest, title} = p', '  title'),
    ).toEqual([2034]);
    expect(
      codesOf(page, 'fn f(p: Page) -> String:', '  const struct{title, ...a, ...b} = p', '  title'),
    ).toEqual([2034]);
    expect(
      codesOf(
        'enum Shape { Circle(radius: Int), Square(side: Int) }',
        'fn f(s: Shape) -> Int:',
        '  match s:',
        '    case Circle{...rest}: 1',
        '    case _: 0',
      ),
    ).toEqual([5433]);
  });

  it('formats as written, last in its braces', () => {
    const source = [
      'fn f(p: { a: Int, b: Int }) -> Int:',
      '  const struct{a,   ...rest} = p',
      '  match p:',
      '    case struct{b == 1, ..._}: a',
      '    case _: rest.b',
      '',
    ].join('\n');
    const formatted = formatText(source) ?? '';
    expect(formatted).toContain('const struct{a, ...rest} = p');
    expect(formatText(formatted)).toBe(formatted);
  });
});

/** The type each generated field is spelled with in a struct declaration. */
function declared(fields: readonly GeneratedField[]): string {
  return fields.map((field) => `${field.name}: ${field.type}`).join(', ');
}

/** The fields in name order, as every struct visits them (§3.1). */
function inNameOrder(fields: readonly GeneratedField[]): readonly GeneratedField[] {
  return [...fields].sort((first, second) => (first.name < second.name ? -1 : 1));
}

/** What a split prints: the named field, then each field of the rest as `name=value`. */
function splitText(named: GeneratedField, rest: readonly GeneratedField[]): string {
  const literal = (field: GeneratedField) => field.value.replaceAll('"', '');
  return [
    literal(named),
    ...inNameOrder(rest).map((field) => `${field.name}=${literal(field)}`),
  ].join('|');
}

describe('the commute law for rests', () => {
  it('agrees generic, over the concrete struct and written by hand, empty rests included', async () => {
    await fc.assert(
      fc.asyncProperty(generatedFieldsArbitrary, async (fields) => {
        const [named, ...rest] = fields;
        if (named === undefined) {
          return;
        }
        const body = (parameter: string) => [
          `  const struct{${named.name}, ...rest} = ${parameter}`,
          `  let out = \`\${${named.name}}\``,
          '  for k, v in ...rest:',
          '    out = `${out}|${k}=${v}`',
          '  out',
        ];
        const declarations = [
          `struct Generated { ${declared(fields)} }`,
          `fn generic<S is struct { ${named.name}: ${named.type}, [_] is Stringable }>(s: S) -> String:`,
          ...body('s'),
          'fn concrete(g: Generated) -> String:',
          ...body('g'),
          'fn rebuilt(g: Generated) -> Bool:',
          `  const struct{${named.name}, ...rest} = g`,
          `  rest == struct{${rest.map((field) => `${field.name}: g.${field.name}`).join(', ')}}`,
        ];
        const value = `Generated{${fields.map((field) => `${field.name}: ${field.value}`).join(', ')}}`;
        const lines = [`const g = ${value}`, '`${generic(g)}#${concrete(g)}#${rebuilt(g)}`'];
        const expected = splitText(named, rest);
        expect(await runText(lines, declarations)).toBe(`${expected}#${expected}#true`);
      }),
      { numRuns: 25 },
    );
  });
});
