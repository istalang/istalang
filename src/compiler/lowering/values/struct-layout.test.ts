/**
 * Every struct lays its fields out in name order, nominal or shape (§3.1 "Field order"): the
 * Definition's entry for a declared struct lists them as its shape's does, while declaration order
 * stays what evaluation follows, so a default still sees the fields declared before it. Fields are
 * drawn in shuffled declaration order, so a layout following the declaration, or a value built in
 * it, shows as swapped values or a differently ordered entry.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeJson } from '../../../definition/formats/codec.ts';
import { compareOrdered } from '../../../foundation/language/order.ts';
import { startToEnd, testRuntime } from '../../../runtime/runtime.test-kit.ts';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { compiledDefinition, compiledText } from '../../compile.test-kit.ts';

/**
 * camelCase names whose UTF-16 order differs from any other: `aB` before `aa`, `z10` before `z9`.
 */
const names = ['b', 'a', 'aB', 'z9', 'z10', 'aa', 'ab', 'c'] as const;

/** A field as declared: its name, and its default's value, if any, from the field before it. */
interface DeclaredField {
  readonly name: string;
  readonly defaulted: boolean;
}

const declaredFields = fc
  .shuffledSubarray([...names], { minLength: 1 })
  .chain((picked) =>
    fc.tuple(...picked.map((name) => fc.boolean().map((defaulted) => ({ name, defaulted })))),
  );

/**
 * Each field's value: given ones by position, a default one more than the field declared before it.
 */
function expectedValues(fields: readonly DeclaredField[]): Record<string, number> {
  const values: Record<string, number> = {};
  let before = 0;
  for (const [index, { name, defaulted }] of fields.entries()) {
    const value = defaulted ? before + 1 : 10 * (index + 1);
    values[name] = value;
    before = value;
  }
  return values;
}

/** `struct S` declaring `fields` in order, each default reading the field declared before it. */
function declaration(fields: readonly DeclaredField[]): string {
  const lines = fields.map(({ name, defaulted }, index) => {
    const previous = fields[index - 1]?.name;
    const value = previous === undefined ? '1' : `${previous} + 1`;
    return `  ${name}: Int${defaulted ? ` = ${value}` : ''}`;
  });
  return ['struct S:', ...lines].join('\n');
}

/** A literal giving the fields without a default, in reverse declaration order. */
function literal(fields: readonly DeclaredField[]): string {
  const given = fields
    .flatMap(({ name, defaulted }, index) => (defaulted ? [] : [`${name}: ${10 * (index + 1)}`]))
    .reverse();
  return `S{${given.join(', ')}}`;
}

function inNameOrder(fields: readonly { readonly name: string }[]): readonly string[] {
  return fields.map(({ name }) => name).sort(compareOrdered);
}

describe('struct layout', () => {
  it("lists a declared struct's fields in name order, as its shape's entry does (§3.1)", () => {
    const program = stdProgramOf({
      main: [
        'struct P { y: Int, x: Int, aZ: Int }',
        'async fn main() -> Future<Int>:',
        '  const p = P{y: 1, x: 2, aZ: 3}',
        '  const shape: { y: Int, x: Int, aZ: Int } = p',
        '  p.x + shape.y',
      ].join('\n'),
    });
    const { types } = compiledDefinition(program, 'main');
    const fieldNames = (name: string) =>
      types.flatMap((type) =>
        type.kind === 'struct' && type.name === name ? [type.fields.map((f) => f.name)] : [],
      );
    expect(fieldNames('main.P')).toEqual([['aZ', 'x', 'y']]);
    expect(fieldNames('')).toEqual([['aZ', 'x', 'y']]);
  });

  it('reads JSON into a struct field by field in name order, reporting the first mismatch (§9)', async () => {
    const text = compiledText(
      [
        "import * as json from 'json'",
        'struct Late { b: Int, a: Int }',
        'async fn main() -> Future<String>:',
        '  match json.parse<Late>("{}"):',
        '    case Ok(value): "parsed"',
        '    case Err(error): error.message',
      ].join('\n'),
    );
    const state = await startToEnd(testRuntime(), text);
    expect(state.kind === 'finished' && decodeJson(String(state.outcome))).toBe('$.a: missing');
  });

  it('builds a range by its fields, whatever order they are laid out in (§3.8)', async () => {
    const text = compiledText(
      ['async fn main() -> Future<Array<Int>>:', '  [for i in 1..7 by 2: i]'].join('\n'),
    );
    const state = await startToEnd(testRuntime(), text);
    expect(state.kind === 'finished' && decodeJson(String(state.outcome))).toEqual([1, 3, 5]);
  });

  it('gives every field its value, defaults evaluated in declaration order', async () => {
    await fc.assert(
      fc.asyncProperty(declaredFields, async (fields) => {
        const reads = fields.map(({ name }) => `s.${name}`).join(', ');
        const shapeReads = fields.map(({ name }) => `shape.${name}`).join(', ');
        const shapeType = fields.map(({ name }) => `${name}: Int`).join(', ');
        const main = [
          declaration(fields),
          'async fn main() -> Future<(Array<Int>, Array<Int>)>:',
          `  const s = ${literal(fields)}`,
          `  const shape: { ${shapeType} } = s`,
          `  ([${reads}], [${shapeReads}])`,
        ].join('\n');
        const program = stdProgramOf({ main });
        const { types } = compiledDefinition(program, 'main');
        const entry = types.find((type) => type.name === 'main.S');
        expect(entry?.kind === 'struct' && entry.fields.map((f) => f.name)).toEqual(
          inNameOrder(fields),
        );
        const state = await startToEnd(testRuntime(), compiledText(main));
        const expected = expectedValues(fields);
        const values = fields.map(({ name }) => expected[name]);
        expect(state.kind === 'finished' && decodeJson(String(state.outcome))).toEqual([
          values,
          values,
        ]);
      }),
      { numRuns: 40 },
    );
  });
});
