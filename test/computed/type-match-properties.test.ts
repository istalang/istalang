/**
 * Type `match` commutes with instantiation (§3.5, §3.17; test/AGENTS.md): a generic function over a
 * type match alias, instantiated with a type argument, gives what the same function written for
 * the argument gives, including arguments that distribute over a union and collapse, and a reduced
 * mapped data type is the shape written by hand.
 */

import { describe, expect, it } from 'vitest';
import { compareWrittenTypes, runMain } from '../written-types.test-kit.ts';
import { sameComputedType } from './computed.test-kit.ts';

const declarations = [
  'struct Box<T> { value: T }',
  'type Unwrap<T> = match T:',
  '  case Box<infer V>: V',
  '  case _: T',
  'fn kept<T>(x: Unwrap<T>) -> Unwrap<T>: x',
];

/** A type argument as written, and a value of what `Unwrap` reduces it to, as written. */
const argumentsAndValues = [
  { written: 'Int', value: '3' },
  { written: 'Box<Int>', value: '4' },
  { written: 'Box<"a"> | Box<"b">', value: '"b"' },
  { written: 'Box<Int> | Int', value: '7' },
  { written: 'Box<Int>?', value: 'none' },
  { written: 'Box<Box<Int>>', value: 'Box{value: 5}' },
  { written: 'Never | Box<Int>', value: '6' },
] as const;

describe('a type match under instantiation', () => {
  it.each(argumentsAndValues)(
    'gives what the substituted program gives, instantiated with $written',
    async ({ written, value }) => {
      const result = `Unwrap<${written}>`;
      const generic = await runMain(result, `kept<${written}>(${value})`, declarations);
      const substituted = await runMain(result, `direct(${value})`, [
        ...declarations,
        `fn direct(x: ${result}) -> ${result}: x`,
      ]);
      expect(generic).toEqual(substituted);
    },
  );

  it('reduces a form schema to the shape written by hand', () => {
    const schema = [
      'struct Field<T> { value: T? }',
      'struct Repeat<Row> { rows: Array<Row> }',
      'struct Item { sku: Field<String>, qty: Field<Int> }',
      'struct OrderForm { country: Field<String>, items: Repeat<Item> }',
      'type DataOf<D> = match D:',
      '  case Field<infer T>: T',
      '  case Repeat<infer R>: Array<DataOf<R>>',
      '  case struct: { [F in keyof D]: DataOf<D[F]> }',
    ];
    expect(
      compareWrittenTypes(
        'DataOf<OrderForm>',
        '{ items: Array<{ qty: Int, sku: String }>, country: String }',
        schema,
      ),
    ).toEqual(sameComputedType);
  });
});
