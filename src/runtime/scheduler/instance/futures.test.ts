/**
 * Futures (spec §3.8, §6): a future resolves once, and `futures.first` resolves with the position
 * and value of the first of its futures to resolve, the lowest position among those resolved
 * together, whatever order they resolve in.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Value } from '../../../definition/values/values.ts';
import { Unreachable } from '../../../foundation/structures/unreachable.ts';
import { Panic } from '../../natives.ts';
import { futuresOn } from './futures.test-kit.ts';
import type { Futures } from './futures.ts';
import { Heap, handleObject } from './heap.ts';

function freshFutures() {
  return futuresOn(new Heap([]));
}

/** The position and value a `first` resolved with. */
function won(futures: Futures, first: Value) {
  const settled = futures.settled(first)?.value;
  if (settled === undefined || settled === null || typeof settled !== 'object') {
    return;
  }
  return settled.kind === 'tuple' ? settled.elements : undefined;
}

/** Values as plain data: a `first`'s tuple as its elements, at any depth. */
function nested(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(nested);
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    'kind' in value &&
    value.kind === 'tuple' &&
    'elements' in value
  ) {
    return nested(value.elements);
  }
  return value;
}

describe('futures', () => {
  it('resolve once', () => {
    const futures = freshFutures();
    const id = futures.create({ kind: 'timer', at: 5n });
    futures.resolve(id, null);
    expect(() => futures.resolve(id, null)).toThrow(Unreachable);
  });

  it('race in first at the lowest position among those already resolved', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), (resolved) => {
        const futures = freshFutures();
        const handles = resolved.map((isResolved, position) =>
          futures.createHandle(
            isResolved ? { kind: 'resolved', value: BigInt(position) } : { kind: 'timer', at: 1n },
          ),
        );
        const winner = resolved.indexOf(true);
        const first = futures.first(handles);
        expect(won(futures, first)).toEqual(
          winner < 0 ? undefined : [BigInt(winner), BigInt(winner)],
        );
      }),
    );
  });

  it('race in first at whichever of the pending ones resolves first', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }).chain((count) =>
          fc.tuple(
            fc.constant(count),
            fc.shuffledSubarray(
              Array.from({ length: count }, (_, position) => position),
              { minLength: 1 },
            ),
          ),
        ),
        ([count, order]) => {
          const futures = freshFutures();
          const handles = Array.from({ length: count }, () =>
            futures.createHandle({ kind: 'timer', at: 1n }),
          );
          const first = futures.first(handles);
          for (const position of order) {
            futures.resolve(handleObject(handles[position] ?? null), BigInt(position));
          }
          expect(won(futures, first)).toEqual([BigInt(order[0] ?? 0), BigInt(order[0] ?? 0)]);
        },
      ),
    );
  });

  it.each([
    ['before', true, [0n, 7n]],
    ['after', false, [0n, [0n, 7n]]],
  ])(
    'race in first at the lowest position resolved together, the shared future %s the other first',
    (_where, sharedFirst, expected) => {
      const futures = freshFutures();
      const shared = futures.createHandle({ kind: 'timer', at: 1n });
      const inner = futures.first([shared]);
      const outer = futures.first(sharedFirst ? [shared, inner] : [inner, shared]);
      futures.resolve(handleObject(shared), 7n);
      expect(won(futures, inner)).toEqual([0n, 7n]);
      expect(nested(won(futures, outer))).toEqual(expected);
    },
  );

  it('panic in first given no futures', () => {
    expect(() => freshFutures().first([])).toThrow(Panic);
  });
});
