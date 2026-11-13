import { describe, expect, it } from 'vitest';
import { typeText } from '../../../compiler/checker/types/type/type-text.ts';
import { programAt } from '../language-service.test-kit.ts';
import { checkedModule } from '../reading/checked-module.ts';
import { cursorAt } from './cursor.ts';
import { expectedTypeAt, expectedVariants } from './expected.ts';
import { placeAt } from './place.ts';

const declarations = [
  'enum Color { Red, Green }',
  'enum Verdict<T> { Approved(by: T), Rejected(by: T, reason: Int), Expired }',
  'struct Cfg { color: Color, n: Int, note: String }',
  'fn paint(c: Color, n: Int) -> Int: n',
  'fn show(cfg: Cfg) -> Int: cfg.n',
  'fn mix(c: Color) -> Int: 1',
  'fn mix(n: Int) -> Int: n',
  '',
];

/** The cursor and its place in `body`, the body of a function of `col` returning `Color`. */
function placed(body: string) {
  const { program, module, offset } = programAt(
    ...declarations,
    'fn f(col: Color, cfg: Cfg) -> Color:',
    body,
    '  col',
  );
  const checked = checkedModule(program, module);
  if (checked === undefined) {
    throw new Error('no main module');
  }
  const cursor = cursorAt(checked, offset, undefined, []);
  return { cursor, place: placeAt(cursor) };
}

function expectedAt(body: string): string | undefined {
  const { cursor, place } = placed(body);
  const expected = expectedTypeAt(cursor, place);
  return expected && typeText(expected);
}

describe('the type expected where a value is written', () => {
  it.each([
    ['a field of a literal', '  const c = Cfg{color: ‸', 'Color'],
    ['an annotated declaration', '  let c: Color = ‸', 'Color'],
    ['an optional one', '  let c: Color? = ‸', 'Color?'],
    ['a `return`', '  return ‸', 'Color'],
    ['a comparison', '  let b = col == ‸', 'Color'],
    ['a literal spread', '  const c = Cfg{...‸', 'Cfg'],
    ["a call's argument", '  paint(‸', 'Color'],
    ["a call's later argument", '  paint(Color.Red, ‸', 'Int'],
    ['a named argument', '  paint(n: ‸', 'Int'],
    ["a literal's field inside an argument", '  paint(Cfg{note: ‸', 'String'],
    ['a name already written', '  let c: Color = co‸l', 'Color'],
    ["an argument's literal, its name being written", '  show(Cf‸{n: 1})', 'Cfg'],
    ["a `match` case's pattern", '  match col:\n    case ‸', 'Color'],
    [
      "a variant's field, the others not written yet",
      '  const v: Verdict<Color> = Rejected(‸',
      'Color',
    ],
    [
      "a variant's named field, the others not written yet",
      '  const v: Verdict<Color> = Rejected(by: ‸',
      'Color',
    ],
  ])('is the checker’s at %s', (_construct, body, expected) => {
    expect(expectedAt(body)).toBe(expected);
  });

  it('is nothing where no type is expected, or no value is written', () => {
    expect(expectedAt('  let x = ‸')).toBeUndefined();
    expect(expectedAt('  col.‸')).toBeUndefined();
    expect(expectedAt('  let x: ‸')).toBeUndefined();
  });

  it("is the checker's nothing at an argument of a call that can't choose its function yet", () => {
    expect(expectedAt('  mix(‸')).toBeUndefined();
    expect(expectedAt('  mix(Color.‸')).toBeUndefined();
  });
});

describe('the variants written bare', () => {
  const variants = (body: string) => {
    const { cursor, place } = placed(body);
    return expectedVariants(cursor, place).map(({ name }) => name);
  };

  it("are the expected enum's, then those of the enums inside its optionals", () => {
    expect(variants('  let c: Color = ‸')).toEqual(['Red', 'Green']);
    expect(variants('  let c: Color? = ‸')).toEqual(['Red', 'Green']);
    expect(variants('  let n: Int? = ‸')).toEqual([]);
  });

  it('are none where no enum is expected', () => {
    expect(variants('  let x = ‸')).toEqual([]);
    expect(variants('  paint(Color.Red, ‸')).toEqual([]);
  });
});
