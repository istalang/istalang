/**
 * The heap's indexes against their definition, over random heaps changed by random adds, replaces
 * and removes: every lookup finds exactly what a scan of the heap's objects finds, in creation
 * order, and each kind's objects are listed in creation order. The objects written are those
 * replaced. Its holder writes are exact: what they report held, less what they report let go of,
 * is what its objects hold, their index edges included, however it changed, and ids are serials,
 * never given twice.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { handleTo } from '../../../definition/values/values.ts';
import { HolderWrites } from '../../lifetimes/holder-writes.ts';
import { type Held, idsHeld } from '../../snapshot/holdings.ts';
import type { FutureState } from '../../snapshot/objects.ts';
import { testHeap } from './heap.test-kit.ts';
import type { Heap, LiveObject, LiveObjectOf } from './heap.ts';

type ResolverState = LiveObjectOf<'resolver'>['state'];

const ids = [0, 1, 2, 3, 4, 5];
const tokens = ['a', 'b'];
const id = fc.constantFrom(...ids);

const stateArbitrary = fc.oneof(
  fc.constant<FutureState>({ kind: 'resolved', value: null }),
  fc.constant<FutureState>({ kind: 'call' }),
  fc.constantFrom(...tokens).map((token): FutureState => ({ kind: 'host', token })),
  fc.bigInt({ min: 0n, max: 9n }).map((at): FutureState => ({ kind: 'timer', at })),
  id.map((weakRef): FutureState => ({ kind: 'disposed', weakRef })),
);

/** An object some index files, made once the heap gives it its id. */
type Made = (id: number) => LiveObject;

const madeArbitrary: fc.Arbitrary<Made> = fc.oneof(
  id.map(
    (target): Made =>
      (object) => ({ kind: 'cell', id: object, type: 0, value: handleTo(target) }),
  ),
  stateArbitrary.map(
    (state): Made =>
      (object) => ({ kind: 'future', id: object, state }),
  ),
  fc.oneof(id, fc.constantFrom('disposed' as const, 'callEnded' as const)).map(
    (target): Made =>
      (object) => ({ kind: 'weakRef', id: object, target }),
  ),
  fc.option(id, { nil: undefined }).map(
    (resolves): Made =>
      (object) => ({ kind: 'execution', id: object, resolves, frames: [], disposing: false }),
  ),
  id.map(
    (waiter): Made =>
      (object) => ({ kind: 'wait', id: object, waiter, state: { kind: 'pending' } }),
  ),
  fc
    .oneof(
      fc
        .record({
          target: fc.oneof(
            fc.constant({ kind: 'callback' as const, callback: null }),
            id.map((wait) => ({ kind: 'case' as const, wait, position: 0 })),
            id.map((done) => ({ kind: 'at' as const, done, position: 0n, root: 'case' as const })),
          ),
          on: fc.uniqueArray(id, { maxLength: 2 }),
        })
        .map(({ target, on }): ResolverState => ({ kind: 'pending', target, on, onCancel: [] })),
      fc.constantFrom<ResolverState>({ kind: 'resolved' }, { kind: 'cancelled' }),
    )
    .map(
      (state): Made =>
        (object) => ({ kind: 'resolver', id: object, state: deciding(state, object) }),
    ),
);

/** `state` as resolver `resolver`'s: a `Resolver.at` one decides a resolver made before it. */
function deciding(state: ResolverState, resolver: number): ResolverState {
  if (state.kind !== 'pending' || state.target.kind !== 'at') {
    return state;
  }
  return { ...state, target: { ...state.target, done: Math.min(state.target.done, resolver - 1) } };
}

type Change =
  | { readonly kind: 'add'; readonly make: Made }
  | { readonly kind: 'replace' | 'remove'; readonly at: number; readonly make: Made };

const changeArbitrary: fc.Arbitrary<Change> = fc.oneof(
  madeArbitrary.map((make): Change => ({ kind: 'add', make })),
  fc
    .record({
      kind: fc.constantFrom('replace' as const, 'remove' as const),
      at: fc.nat(),
      make: madeArbitrary,
    })
    .map((each): Change => each),
);

/**
 * Applies `step` to `heap`, a replace keeping its object's kind, so one of another kind is
 * skipped; the id of the object it replaced, if it did.
 */
function apply(heap: Heap, step: Change): number | undefined {
  if (step.kind === 'add') {
    heap.add(step.make);
    return undefined;
  }
  const objects = heap.objects();
  const target = objects[step.at % Math.max(1, objects.length)];
  if (target === undefined) {
    return undefined;
  }
  if (step.kind === 'remove') {
    heap.remove(target.id);
    return undefined;
  }
  const replacement = step.make(target.id);
  if (replacement.kind !== target.kind) {
    return undefined;
  }
  heap.replace(replacement);
  return target.id;
}

const idsOf = (objects: readonly LiveObject[]) => objects.map((object) => object.id);

describe('heap indexes', () => {
  it('find what a scan finds, in creation order, however the heap changed', () => {
    fc.assert(
      fc.property(
        fc.array(madeArbitrary, { maxLength: 6 }),
        fc.array(changeArbitrary, { maxLength: 12 }),
        (initial, changes) => {
          const heap = testHeap(initial.map((make, position) => make(position)));
          for (const step of changes) {
            apply(heap, step);
          }
          const objects = heap.objects();
          const futures = heap.objectsOf('future');
          expect(idsOf(heap.objectsOf('weakRef'))).toEqual(
            idsOf(objects.filter((object) => object.kind === 'weakRef')),
          );
          for (const key of [undefined, ...ids]) {
            expect(idsOf(heap.find('executions', key))).toEqual(
              idsOf(heap.objectsOf('execution').filter((each) => each.resolves === key)),
            );
          }
          for (const key of ids) {
            expect(idsOf(heap.find('weakRefs', key))).toEqual(
              idsOf(heap.objectsOf('weakRef').filter((each) => each.target === key)),
            );
            expect(idsOf(heap.find('watches', key))).toEqual(
              idsOf(
                futures.filter(({ state }) => state.kind === 'disposed' && state.weakRef === key),
              ),
            );
            const resolvers = heap.objectsOf('resolver');
            expect(idsOf(heap.find('resolvers', key))).toEqual(
              idsOf(
                resolvers.filter(({ state }) => state.kind === 'pending' && state.on.includes(key)),
              ),
            );
            expect(idsOf(heap.find('cases', key))).toEqual(
              idsOf(
                resolvers.filter(
                  ({ state }) =>
                    state.kind === 'pending' &&
                    state.target.kind === 'case' &&
                    state.target.wait === key,
                ),
              ),
            );
            expect(idsOf(heap.find('positions', key))).toEqual(
              idsOf(
                resolvers.filter(
                  ({ state }) =>
                    state.kind === 'pending' &&
                    state.target.kind === 'at' &&
                    state.target.done === key,
                ),
              ),
            );
          }
          for (const key of tokens) {
            expect(idsOf(heap.find('hostFutures', key))).toEqual(
              idsOf(futures.filter(({ state }) => state.kind === 'host' && state.token === key)),
            );
          }
          for (const key of ['timer', 'host'] as const) {
            expect(idsOf(heap.find('pending', key))).toEqual(
              idsOf(futures.filter(({ state }) => state.kind === key)),
            );
          }
          expect(idsOf(objects)).toEqual(
            idsOf(objects).toSorted((first, second) => first - second),
          );
        },
      ),
    );
  });
});

describe('heap writes', () => {
  it('are every replace since they were last taken, in order', () => {
    fc.assert(
      fc.property(
        fc.array(madeArbitrary, { maxLength: 6 }),
        fc.array(changeArbitrary, { maxLength: 12 }),
        (initial, changes) => {
          const heap = testHeap(initial.map((make, position) => make(position)));
          const replaced = changes.flatMap((step) => apply(heap, step) ?? []);
          expect(heap.takeWritten()).toEqual(replaced);
          expect(heap.takeWritten()).toEqual([]);
        },
      ),
    );
  });
});

/** Holder writes tallied: each object's holders, as the writes report them held and let go of. */
class Tally extends HolderWrites {
  readonly holders = new Map<number, number>();

  override changed(was: Held, now: Held): void {
    super.changed(was, now);
    for (const [counted, step] of [
      [idsHeld(was), -1],
      [idsHeld(now), 1],
    ] as const) {
      for (const held of counted) {
        this.holders.set(held, (this.holders.get(held) ?? 0) + step);
      }
    }
  }
}

/** How many times each object is held by the objects of `heap`, their index edges included. */
function holdersOf(heap: Heap): ReadonlyMap<number, number> {
  const holders = new Map<number, number>();
  for (const object of heap.objects()) {
    for (const held of object.kind === 'execution' ? [] : heap.holds(object)) {
      holders.set(held, (holders.get(held) ?? 0) + 1);
    }
  }
  return holders;
}

const withoutZeroes = (holders: ReadonlyMap<number, number>) =>
  new Map([...holders].filter(([, count]) => count !== 0));

describe('heap holder writes', () => {
  it('report every holder an object gains and loses, through its index edges too', () => {
    fc.assert(
      fc.property(
        fc.array(madeArbitrary, { maxLength: 6 }),
        fc.array(changeArbitrary, { maxLength: 12 }),
        fc.option(fc.uniqueArray(fc.nat({ max: 20 })), { nil: undefined }),
        (initial, changes, kept) => {
          const tally = new Tally();
          const heap = testHeap(
            initial.map((make, position) => make(position)),
            tally,
          );
          for (const step of changes) {
            apply(heap, step);
          }
          if (kept !== undefined) {
            heap.keepOnly(new Set(kept));
          }
          expect(withoutZeroes(tally.holders)).toEqual(holdersOf(heap));
        },
      ),
    );
  });

  it('number objects in the order made, never giving an id twice, whatever a commit lets go of', () => {
    fc.assert(
      fc.property(
        fc.array(madeArbitrary, { maxLength: 6 }),
        fc.array(fc.option(changeArbitrary, { nil: undefined }), { maxLength: 12 }),
        (initial, changes) => {
          const heap = testHeap(initial.map((make, position) => make(position)));
          const given = heap.objects().map((object) => object.id);
          for (const step of changes) {
            if (step === undefined) {
              heap.keepOnly(new Set());
            } else if (step.kind === 'add') {
              given.push(heap.add(step.make).id);
            } else {
              apply(heap, step);
            }
          }
          expect(given).toEqual(given.map((_, position) => position));
          expect(heap.made).toBe(given.length);
        },
      ),
    );
  });
});
