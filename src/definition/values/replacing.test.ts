/**
 * Rebuilding a value with parts replaced, against a direct recursive definition over random values:
 * the same value where nothing is replaced, each outermost part `replace` takes replaced, and no
 * limit from the host's stack however deep the value nests.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { replacingParts } from './replacing.ts';
import { nested, valueArbitrary } from './values.test-kit.ts';
import {
  type CompositeValue,
  childValues,
  depthOf,
  handleTarget,
  isComposite,
  type Value,
  withChildValues,
} from './values.ts';

/** `value` with each handle made the id it names, by recursion on the host's stack. */
function idsForHandles(value: Value): Value {
  if (!isComposite(value)) {
    return value;
  }
  const target = handleTarget(value);
  return target === undefined
    ? withChildValues(value, childValues(value).map(idsForHandles))
    : BigInt(target);
}

const handleId = (part: CompositeValue): Value | undefined => {
  const target = handleTarget(part);
  return target === undefined ? undefined : BigInt(target);
};

describe('replacing parts', () => {
  it('gives the value back where nothing is replaced', () => {
    fc.assert(
      fc.property(valueArbitrary({ typed: true, handles: [0, 1] }), (value) => {
        expect(replacingParts(value, () => undefined)).toEqual(value);
      }),
    );
  });

  it('replaces each part it is given a value for', () => {
    fc.assert(
      fc.property(valueArbitrary({ typed: true, handles: [0, 1, 2] }), (value) => {
        expect(replacingParts(value, handleId)).toEqual(idsForHandles(value));
      }),
    );
  });

  it('asks only of the outermost of the parts it replaces', () => {
    const asked: Value[] = [];
    const inner = nested(1, 1n);
    const outer = nested(1, inner);
    const value = replacingParts(nested(1, outer), (part) => {
      asked.push(part);
      return part === outer ? 'outer' : undefined;
    });
    expect(value).toEqual(nested(1, 'outer'));
    expect(asked).not.toContain(inner);
  });

  it('walks a value nesting deeper than the host stack goes', () => {
    const depth = 200_000;
    expect(depthOf(replacingParts(nested(depth, null), () => undefined))).toBe(depth);
  });
});
