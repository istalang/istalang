/**
 * The codec: exact integers at any size, one canonical text per value whatever its key order,
 * and a hash of that text.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Unreachable } from '../../foundation/structures/unreachable.ts';
import { exactJson, looseText, reverseKeys } from './codec.test-kit.ts';
import { contentHash, decodeJson, encodeJson } from './codec.ts';

describe('codec', () => {
  it('round-trips integers of any size, floats and strings exactly', () => {
    fc.assert(
      fc.property(exactJson, (json) => {
        expect(decodeJson(encodeJson(json))).toEqual(json);
      }),
    );
  });

  it('writes one text per value, whatever the key order', () => {
    fc.assert(
      fc.property(exactJson, (json) => {
        expect(encodeJson(reverseKeys(json))).toBe(encodeJson(json));
      }),
    );
  });

  it('reads a non-canonical text back to the canonical one', () => {
    fc.assert(
      fc.property(exactJson, (json) => {
        expect(encodeJson(decodeJson(looseText(json)))).toBe(encodeJson(json));
      }),
    );
  });

  it('sorts keys by UTF-16 code unit and leaves no whitespace', () => {
    const mixedCase = Object.fromEntries([
      ['z', 3],
      ['Z', 4],
    ]);
    const json = Object.fromEntries([
      ['é', 5],
      ['b', 1],
      ['a', [2, mixedCase]],
    ]);
    expect(encodeJson(json)).toBe('{"a":[2,{"Z":4,"z":3}],"b":1,"é":5}');
  });

  it('keeps a safe integer as a number and an unsafe one as a bigint', () => {
    expect(decodeJson('[9007199254740991, 9007199254740992, -1e3, 1.5]')).toEqual([
      9_007_199_254_740_991,
      9_007_199_254_740_992n,
      -1000,
      1.5,
    ]);
  });

  it('hashes equal texts equally, as 64 hex digits', () => {
    const text = encodeJson({ a: 10n ** 40n });
    expect(contentHash(text)).toHaveLength(64);
    expect(contentHash(text)).toBe(contentHash(encodeJson(decodeJson(text))));
    expect(contentHash(text)).not.toBe(contentHash(encodeJson({ a: 10n ** 40n + 1n })));
  });

  it('refuses values JSON cannot hold', () => {
    expect(() => encodeJson(undefined)).toThrow(Unreachable);
  });
});
