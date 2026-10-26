/**
 * JSON moved between `Json` values, text and JavaScript values: any JSON a host could hand over
 * survives the trip as `JSON.parse` would see it, integers keep every digit in text, and input
 * that isn't JSON, or nests too deeply, is refused with a JsonError rather than a crash.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { valuesEqual } from './equality.ts';
import {
  JsonError,
  type JsonType,
  jsonOfPlain,
  jsonOfText,
  jsonText,
  jsonTypeIn,
  jsonTypeName,
  plainOfJson,
} from './json-values.ts';
import { maximumDepth } from './values.ts';

/** Where a program's types hold `Json`, as the json module declares it. */
const shape: JsonType = (() => {
  const variants = ['Null', 'Bool', 'Integer', 'Number', 'Text', 'List', 'Object'];
  const found = jsonTypeIn([
    {
      kind: 'enum',
      name: jsonTypeName,
      arguments: [],
      variants: variants.map((name) => ({ name, fields: [] })),
    },
  ]);
  if (found === undefined) {
    throw new Error('No Json type in the table.');
  }
  return found;
})();

/** Whether reading `text` gave a value, refused it as a JsonError, or crashed. */
function reading(text: string): 'read' | 'refused' | 'crashed' {
  try {
    jsonOfText(text, shape);
    return 'read';
  } catch (error) {
    return error instanceof JsonError ? 'refused' : 'crashed';
  }
}

/** A `JSON.parse` reviver giving every integer as a bigint, as a host receives it. */
function bigInts(_: string, value: unknown): unknown {
  return typeof value === 'number' && Number.isInteger(value) ? BigInt(value) : value;
}

/** JSON as a host might give it, with `undefined` anywhere a value goes, the top level too. */
const withUndefined = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.constant(undefined),
    fc.jsonValue({ maxDepth: 0 }),
    fc.array(tie('value')),
    fc.dictionary(fc.string(), tie('value')),
  ),
})).value;

describe('Json values', () => {
  it('carry any JSON a host gives as JSON.parse would read it back, integers as bigints', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (plain) => {
        const json = jsonOfPlain(plain, shape);
        const text = JSON.stringify(plain);
        expect(plainOfJson(json, shape)).toEqual(JSON.parse(text, bigInts));
        expect(JSON.parse(jsonText(json, shape))).toEqual(JSON.parse(text));
      }),
    );
  });

  it('write text that reads back to an equal value, written the same', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (plain) => {
        const json = jsonOfPlain(plain, shape);
        const text = jsonText(json, shape);
        expect(valuesEqual(jsonOfText(text, shape), json)).toBe(true);
        expect(jsonText(jsonOfText(text, shape), shape)).toBe(text);
      }),
    );
  });

  it("write every object's keys sorted as strings, whatever order it was built in", () => {
    const json = jsonOfPlain({ b: { y: 1, x: 2 }, 10: true, a: [{ d: 1, c: 2 }], 9: null }, shape);
    expect(jsonText(json, shape)).toBe(
      '{"10":true,"9":null,"a":[{"c":2,"d":1}],"b":{"x":2,"y":1}}',
    );
  });

  it('keep every digit of an integer in text', () => {
    fc.assert(
      fc.property(fc.bigInt(), (value) => {
        const text = `[${value}]`;
        expect(jsonText(jsonOfText(text, shape), shape)).toBe(text);
      }),
    );
  });

  it('refuse text that is not JSON, nests too deeply, or repeats a key with another value', () => {
    const deep = `${'['.repeat(maximumDepth + 1)}${']'.repeat(maximumDepth + 1)}`;
    for (const text of ['', '{', 'nul', '[1,]', "{'a':1}", deep, '{"a":1,"a":2}']) {
      expect(() => jsonOfText(text, shape)).toThrow(JsonError);
    }
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(reading(text)).not.toBe('crashed');
      }),
    );
  });

  it('read undefined as JSON.stringify writes it: null, or a field left out of an object', () => {
    fc.assert(
      fc.property(withUndefined, (plain) => {
        const written: unknown = plain === undefined ? null : JSON.parse(JSON.stringify(plain));
        expect(valuesEqual(jsonOfPlain(plain, shape), jsonOfPlain(written, shape))).toBe(true);
      }),
    );
  });

  it('refuse JavaScript values JSON cannot hold', () => {
    for (const plain of [Number.NaN, Number.POSITIVE_INFINITY, () => 1, Symbol('s')]) {
      expect(() => jsonOfPlain(plain, shape)).toThrow(JsonError);
    }
  });
});
