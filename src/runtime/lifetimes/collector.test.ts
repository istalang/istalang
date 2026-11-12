/**
 * Collecting by counts (§7), over random heaps of leases (cells whose type declares `dispose`) and
 * plain cells holding them, each object holding only older ones, as making an object does: once
 * a register holding every object nothing else holds lets go of them, the leases are disposed in
 * rounds, newest first in each. A lease's round comes after that of every lease holding it, even
 * through plain cells, which are gone as soon as nothing holds them: a lease held through one is
 * disposed in the round after its holder's, and one held by none in the first.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { handleTo } from '../../definition/values/values.ts';
import { futuresOn } from '../scheduler/instance/futures.test-kit.ts';
import { testHeap } from '../scheduler/instance/heap.test-kit.ts';
import { handleObject, type LiveObject } from '../scheduler/instance/heap.ts';
import { WeakSide } from '../scheduler/instance/weak-side.ts';
import { type Held, nothingHeld } from '../snapshot/holdings.ts';
import { Collector } from './collector.ts';
import { countedIn } from './counts.ts';
import { HolderWrites } from './holder-writes.ts';
import { counterType, leaseType, testTypes } from './lifetimes.test-kit.ts';

/** Each object a cell: a lease or a plain one, holding some of the objects made before it. */
interface Made {
  readonly lease: boolean;
  readonly holds: readonly number[];
}

/** What `made[id]` holds: objects made before it. */
const holdsOf = (made: readonly Made[], id: number): readonly number[] =>
  (made[id]?.holds ?? []).filter((each) => each < id);

/** The objects of `made` nothing else holds. */
const unheldIn = (made: readonly Made[]): readonly number[] =>
  made.flatMap((_, id) =>
    made.some((__, holder) => holdsOf(made, holder).includes(id)) ? [] : [id],
  );

/** The leases, in the order collecting disposes them once nothing holds the objects `made`. */
function disposalOrder(made: readonly Made[]): readonly number[] {
  const objects = made.map(
    ({ lease }, id): LiveObject => ({
      kind: 'cell',
      id,
      type: lease ? leaseType : counterType,
      value: { kind: 'array', elements: holdsOf(made, id).map(handleTo) },
    }),
  );
  const holders = new HolderWrites(countedIn(testTypes));
  const heap = testHeap(objects, holders);
  const disposed: number[] = [];
  const collector = new Collector({
    heap,
    types: testTypes,
    holders,
    stop: () => undefined,
    cleanupCase: () => undefined,
    weak: new WeakSide(heap, futuresOn(heap)),
    disposed: () => undefined,
    cancel: () => undefined,
    run: (run) => {
      if (run.kind === 'call' && run.arguments[0] !== undefined) {
        disposed.push(handleObject(run.arguments[0]));
      }
      return true;
    },
  });
  const register: Held = { values: unheldIn(made).map(handleTo), holds: [] };
  holders.changed(nothingHeld, register);
  holders.takeZeroes();
  holders.changed(register, nothingHeld);
  collector.collect();
  return disposed;
}

/** The leases of `made` by round, newest first in each: a lease's after every lease holding it. */
function expectedOrder(made: readonly Made[]): readonly number[] {
  const rounds = new Map<number, number>();
  /** The leases holding `id`, directly or through plain cells. */
  const leasesHolding = (id: number): readonly number[] =>
    made
      .flatMap((holder, at) => (holdsOf(made, at).includes(id) ? [{ holder, at }] : []))
      .flatMap(({ holder, at }) => (holder.lease ? [at] : leasesHolding(at)));
  const roundOf = (lease: number): number => {
    const known = rounds.get(lease);
    if (known !== undefined) {
      return known;
    }
    const round = Math.max(-1, ...leasesHolding(lease).map(roundOf)) + 1;
    rounds.set(lease, round);
    return round;
  };
  const leases = made.flatMap(({ lease }, id) => (lease ? [id] : []));
  return leases.toSorted((first, second) => roundOf(first) - roundOf(second) || second - first);
}

describe('collecting by counts', () => {
  it('disposes leases by rounds, after every lease holding them, newest first in each', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            lease: fc.boolean(),
            holds: fc.uniqueArray(fc.nat({ max: 7 }), { maxLength: 3 }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (made) => {
          expect(disposalOrder(made)).toEqual(expectedOrder(made));
        },
      ),
    );
  });

  it('disposes a lease held only through a plain cell at once, and one a lease holds after it', () => {
    const made: readonly Made[] = [
      { lease: true, holds: [] },
      { lease: true, holds: [0] },
      { lease: true, holds: [] },
      { lease: false, holds: [2] },
      { lease: true, holds: [] },
    ];
    expect(disposalOrder(made)).toEqual([4, 2, 1, 0]);
  });
});
