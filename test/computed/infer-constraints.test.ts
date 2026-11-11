/**
 * What an `infer` variable carries (spec §3.17): a case's pattern is a type, so its type arguments
 * meet their parameters' constraints, and an `infer` variable standing at a constrained parameter
 * carries that parameter's constraints into the case's type, beside any it is written with.
 */

import { describe, expect, it } from 'vitest';
import { codesOf, runMain } from '../written-types.test-kit.ts';

const declarations = [
  'trait Shown:',
  '  fn show(self: Self) -> String',
  'trait Sized:',
  '  fn size(self: Self) -> Int',
  'struct Word { text: String }',
  'fn show(self: Word) -> String: self.text',
  'fn size(self: Word) -> Int: self.text.length()',
  'struct Field<T is Shown> { value: T }',
  'struct Shows<T is Shown> { inner: T }',
  'struct Both<T is Shown & Sized> { inner: T }',
];

describe('an infer variable', () => {
  it("carries the constraints of the parameter it stands at, so the case's type may use them", async () => {
    const lines = [
      ...declarations,
      'type ShownOf<D> = match D:',
      '  case Field<infer T>: Shows<T>',
      '  case struct { id: Field<infer K> }: Shows<K>',
      'type BothOf<D> = match D:',
      '  case Field<infer T is Sized>: Both<T>',
    ];
    expect(codesOf(...lines)).toEqual([]);
    const body = [
      'const a: ShownOf<Field<Word>> = Shows{inner: Word{text: "ab"}}',
      'const b: ShownOf<{ id: Field<Word> }> = Shows{inner: Word{text: "c"}}',
      'const c: BothOf<Field<Word>> = Both{inner: Word{text: "def"}}',
      '`${a.inner.show()}|${b.inner.show()}|${c.inner.size()}`',
    ];
    expect(await runMain('String', body.join('\n  '), lines)).toBe('ab|c|3');
  });

  it('carries nothing a written use needs beyond its place: other constraints are refused', () => {
    expect(
      codesOf(...declarations, 'type BothOf<D> = match D:', '  case Field<infer T>: Both<T>'),
    ).toEqual([5101]);
  });

  it("is in a pattern that is a well-formed type: arguments meet their parameters' constraints", () => {
    expect(
      codesOf(
        ...declarations,
        'type Odd<D> = match D:',
        '  case Field<Int>: Int',
        '  case _: String',
      ),
    ).toEqual([5101]);
  });
});
