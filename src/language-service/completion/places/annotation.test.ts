/**
 * Completion in an annotation: the structs that may annotate the item it is on, nothing where the
 * `@` stands for a missing value or type, and the fields of a literal the parser couldn't read.
 */

import { describe, expect, it } from 'vitest';
import { programAt } from '../../language-service.test-kit.ts';
import { completionsAt } from '../index.ts';

const declarations = [
  "import * as json from 'json'",
  'struct Pair:',
  '  first: Int',
  '  second: Int',
  'shared struct Lease:',
  '  name: String',
  'enum Color { Red; Green }',
  'fn plus(a: Int) -> Int: a',
  '',
];

function names(...lines: readonly string[]): readonly string[] {
  const { program, module, offset } = programAt(...declarations, ...lines);
  return completionsAt(program, module, offset).map(({ name }) => name);
}

describe('completion in an annotation', () => {
  it("offers a declaration's or a field's every struct, and the namespaces reaching more", () => {
    for (const offered of [names('@‸', 'fn g(): 1'), names('struct S:', '  a: Int @‸')]) {
      expect(offered).toEqual(expect.arrayContaining(['Pair', 'Waypoint', 'json']));
      for (const other of ['Lease', 'Color', 'plus', 'let']) {
        expect(offered).not.toContain(other);
      }
    }
  });

  it("offers `Waypoint` alone on a statement that waits, and a local function's structs", () => {
    expect(names('async fn t():', '  @‸', '  await t()')).toEqual(['Waypoint']);
    expect(names('async fn t():', '  await t() @‸')).toEqual(['Waypoint']);
    expect(names('fn t():', '  @‸', '  fn local(): 1', '  0')).toContain('Pair');
    expect(names('fn t():', '  @‸', '  let x = 1', '  0')).toEqual([]);
  });

  it('offers nothing where no annotation can stand: among cases, after a bare `return`', () => {
    expect(names('fn t(n: Int) -> Int:', '  match n:', '    @‸', '    case 1: 2', '  0')).toEqual(
      [],
    );
    expect(names('async fn t():', '  return @‸')).toEqual([]);
  });

  it('offers nothing where the `@` stands for a value or a type still missing', () => {
    expect(names('fn t():', '  let x = @‸', '  0')).toEqual([]);
    expect(names('fn t():', '  let x = 1 + @‸', '  0')).toEqual([]);
    expect(names('struct S:', '  a: @‸')).toEqual([]);
  });

  it("offers the fields a literal annotating nothing yet doesn't give, and the spread first", () => {
    expect(names('@Pair{‸')).toEqual(['first', 'second', '...']);
    expect(names('@Pair{first: 1, ‸')).toEqual(['second']);
    expect(names('@Pair{first, ‸')).toEqual(['second']);
    expect(names('@Pair{first: Pair{first: 1, second: 2}.first, ‸')).toEqual(['second']);
    expect(names('@json.JsonName{"n", ‸')).toEqual([]);
    expect(names('@Pair{1, ‸')).toEqual(['first', 'second']);
  });

  it("offers a one-field struct's value unnamed too, its struct qualified or given types", () => {
    expect(names('@json.JsonName{‸')).toEqual(expect.arrayContaining(['...', 'plus']));
    const box = names('struct Box<T>:', '  value: T', '@Box<Array<Int>>{‸');
    expect(box).toEqual(expect.arrayContaining(['value', 'plus']));
    const { program, module, offset } = programAt(
      ...declarations,
      'struct Box<T>:',
      '  value: T',
      '@Box<Array<Int>>{‸',
    );
    const value = completionsAt(program, module, offset).find(({ name }) => name === 'value');
    expect(value?.detail).toBe('Array<Int>');
  });
});
