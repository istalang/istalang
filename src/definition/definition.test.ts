/**
 * A Definition's persisted form: avsc bytes that read back as the Definition written, one Definition
 * always giving the same bytes and hash, and a refusal for what isn't its bytes or doesn't fit them.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compiledEncoded } from '../compiler/compile.test-kit.ts';
import {
  embeddedDefinition,
  embeddedText,
  encodeDefinition,
  readDefinition,
} from './definition.ts';
import { FormatError } from './formats/format.ts';
import type { Definition } from './tables/index.ts';
import { valueArbitrary } from './values/values.test-kit.ts';

const {
  definition: compiled,
  bytes,
  hash,
} = compiledEncoded(
  [
    'fn scaled(by: Float) -> Float: by * -0.0 + 1.5',
    'live async fn main() -> Int: 9223372036854775807',
  ].join('\n'),
);

const negativeIndex = /function -1 is outside the table/u;

/** A Definition of nothing but `constants`, small enough to write once per generated case. */
const ofConstants = (constants: Definition['constants']): Definition => ({
  modules: [],
  types: [],
  functions: [],
  constants,
  starts: [],
  purpose: { kind: 'program' },
});

describe('a Definition persisted', () => {
  it('reads back as the Definition written, keyed by the same hash', () => {
    const read = readDefinition(bytes);
    expect(read.definition).toStrictEqual(compiled);
    expect(read.hash).toBe(hash);
    expect(encodeDefinition(read.definition).bytes).toEqual(bytes);
  });

  it('gives the same bytes and hash every time it is written', () => {
    const again = encodeDefinition(compiled);
    expect(again.bytes).toEqual(bytes);
    expect(again.hash).toBe(hash);
  });

  it('round-trips any constants, as a built module embeds it', () => {
    fc.assert(
      fc.property(fc.array(valueArbitrary({ typed: true }), { maxLength: 4 }), (constants) => {
        const encoded = encodeDefinition(ofConstants(constants));
        const embedded = embeddedDefinition(embeddedText(encoded));
        expect(embedded.definition).toStrictEqual(ofConstants(constants));
        expect(embedded.hash).toBe(encoded.hash);
        expect(encodeDefinition(embedded.definition).bytes).toEqual(encoded.bytes);
      }),
    );
  });

  it('refuses bytes that are not a Definition, or break its rules', () => {
    expect(() => readDefinition(new Uint8Array([1, 2, 3]))).toThrow(FormatError);
    expect(() => readDefinition(bytes.subarray(0, bytes.length - 1))).toThrow(FormatError);
    const outside = encodeDefinition({
      ...compiled,
      starts: compiled.starts.map((start) => ({ ...start, function: -1 })),
    });
    expect(() => readDefinition(outside.bytes)).toThrow(negativeIndex);
  });
});
