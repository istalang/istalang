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
import { countedIn } from '../../lifetimes/counts.ts';
import { HolderWrites } from '../../lifetimes/holder-writes.ts';
import { type Held, idsHeld } from '../../snapshot/holdings.ts';
import type { FutureState } from '../../snapshot/objects.ts';
import { testHeap } from './heap.test-kit.ts';
import { Heap, type LiveObject, type LiveObjectOf } from './heap.ts';

type ResolverState = LiveObjectOf<'resolver'>['state'];

const ids = [0, 1, 2, 3, 4, 5];
const tokens = ['a', 'b'];

/**
 * An object some index files, made once the heap gives it its id, naming only objects it has, as a
 * running heap does: `existing` is every id it has, this one's included.
 */
type Made = (id: number, existing: readonly number[]) => LiveObject;

/** Which of the heap's objects a part names, picked once the object is made. */
const reference = fc.nat({ max: 20 });

/** The object `existing` has that `picked` names. */
const among = (existing: readonly number[], picked: number) =>
  existing[picked % existing.length] ?? 0;

const stateArbitrary = fc.oneof(
  fc.constant((): FutureState => ({ kind: 'resolved', value: null })),
  fc.constant((): FutureState => ({ kind: 'call' })),
  fc.constantFrom(...tokens).map((token) => (): FutureState => ({ kind: 'host', token })),
  fc.bigInt({ min: 0n, max: 9n }).map((at) => (): FutureState => ({ kind: 'timer', at })),
  reference.map(
    (weakRef) =>
      (existing: readonly number[]): FutureState => ({
        kind: 'disposed',
        weakRef: among(existing, weakRef),
      }),
  ),
);

const madeArbitrary: fc.Arbitrary<Made> = fc.oneof(
  reference.map(
    (target): Made =>
      (object, existing) => ({
        kind: 'cell',
        id: object,
        type: 0,
        value: handleTo(among(existing, target)),
      }),
  ),
  stateArbitrary.map(
    (state): Made =>
      (object, existing) => ({ kind: 'future', id: object, state: state(existing) }),
  ),
  fc.oneof(reference, fc.constantFrom('disposed' as const, 'callEnded' as const)).map(
    (target): Made =>
      (object, existing) => ({
        kind: 'weakRef',
        id: object,
        target: typeof target === 'number' ? among(existing, target) : target,
      }),
  ),
  fc.option(reference, { nil: undefined }).map(
    (resolves): Made =>
      (object, existing) => ({
        kind: 'execution',
        id: object,
        resolves: resolves === undefined ? undefined : among(existing, resolves),
        frames: [],
        transients: [],
      }),
  ),
  reference.map(
    (waiter): Made =>
      (object, existing) => ({
        kind: 'wait',
        id: object,
        waiter: among(existing, waiter),
        state: { kind: 'pending' },
      }),
  ),
  fc
    .oneof(
      fc
        .record({
          target: fc.oneof(
            fc.constant({ kind: 'callback' as const, picked: 0 }),
            reference.map((picked) => ({ kind: 'case' as const, picked })),
            reference.map((picked) => ({ kind: 'at' as const, picked })),
          ),
          on: fc.array(reference, { maxLength: 2 }),
        })
        .map(
          ({ target, on }) =>
            (object: number, existing: readonly number[]): ResolverState => ({
              kind: 'pending',
              target: targetOf(target, object, existing),
              on: [...new Set(on.map((picked) => among(existing, picked)))],
              onCancel: [],
            }),
        ),
      fc.constantFrom(
        (): ResolverState => ({ kind: 'resolved' }),
        (): ResolverState => ({ kind: 'cancelled' }),
      ),
    )
    .map(
      (state): Made =>
        (object, existing) => ({ kind: 'resolver', id: object, state: state(object, existing) }),
    ),
);

/**
 * What resolver `resolver` decides: a callback, a case of a wait, or, `Resolver.at`, a resolver
 * made before it, a callback when there is none.
 */
function targetOf(
  target: { readonly kind: 'callback' | 'case' | 'at'; readonly picked: number },
  resolver: number,
  existing: readonly number[],
): Extract<ResolverState, { kind: 'pending' }>['target'] {
  const earlier = existing.filter((each) => each < resolver);
  if (target.kind === 'case') {
    return { kind: 'case', wait: among(existing, target.picked), position: 0 };
  }
  return target.kind === 'at' && earlier.length > 0
    ? { kind: 'at', done: among(earlier, target.picked), position: 0n, root: 'case' }
    : { kind: 'callback', callback: null };
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

/** The objects `initial` makes, each naming only the others. */
function objectsOf(initial: readonly Made[]): readonly LiveObject[] {
  const existing = initial.map((_, position) => position);
  return initial.map((make, position) => make(position, existing));
}

/** The heap holding what `initial` makes. */
const heapOf = (initial: readonly Made[]) => testHeap(objectsOf(initial));

/**
 * Applies `step` to `heap`: a replace keeping its object's kind, so one of another kind is skipped,
 * and a remove only of an object nothing else holds, as the heap removes only those. The id of the
 * object it replaced, if it did.
 */
function apply(heap: Heap, step: Change): number | undefined {
  const objects = heap.objects();
  const existing = objects.map((object) => object.id);
  if (step.kind === 'add') {
    heap.add((made) => step.make(made, [...existing, made]));
    return undefined;
  }
  const target = objects[step.at % Math.max(1, objects.length)];
  if (target === undefined) {
    return undefined;
  }
  if (step.kind === 'remove') {
    const held = objects.some(
      (other) =>
        other.id !== target.id &&
        other.kind !== 'execution' &&
        heap.holds(other).includes(target.id),
    );
    if (!held) {
      heap.remove(target.id);
    }
    return undefined;
  }
  const replacement = step.make(target.id, existing);
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
          const heap = heapOf(initial);
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
          const heap = heapOf(initial);
          const replaced = changes.flatMap((step) => apply(heap, step) ?? []);
          expect(heap.takeWritten()).toEqual(replaced);
          expect(heap.takeWritten()).toEqual([]);
        },
      ),
    );
  });
});

/**
 * The writes of a heap of its own, tallied: each object's holders, as the writes report them held
 * and let go of, and each id reported while its object wasn't in the heap.
 */
class Tally extends HolderWrites {
  readonly heap: Heap;
  readonly holders = new Map<number, number>();
  readonly absent: number[] = [];

  /** Tallies the writes of a new heap that has made `made` objects. */
  constructor(made: number) {
    super(countedIn([]));
    this.heap = new Heap(made, this);
  }

  override changed(was: Held, now: Held): void {
    super.changed(was, now);
    for (const [counted, step] of [
      [idsHeld(was), -1],
      [idsHeld(now), 1],
    ] as const) {
      for (const held of counted) {
        this.holders.set(held, (this.holders.get(held) ?? 0) + step);
        if (!this.heap.has(held)) {
          this.absent.push(held);
        }
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
  it('report every holder an object gains and loses, through its index edges too, each in the heap', () => {
    fc.assert(
      fc.property(
        fc.array(madeArbitrary, { maxLength: 6 }),
        fc.array(changeArbitrary, { maxLength: 12 }),
        fc.option(fc.uniqueArray(fc.nat({ max: 20 })), { nil: undefined }),
        (initial, changes, kept) => {
          const tally = new Tally(initial.length);
          const { heap } = tally;
          heap.restore(objectsOf(initial));
          for (const step of changes) {
            apply(heap, step);
          }
          if (kept !== undefined) {
            heap.keepOnly(new Set(kept));
          }
          const held = holdersOf(heap);
          expect(withoutZeroes(tally.holders)).toEqual(held);
          expect(tally.absent).toEqual([]);
          for (const object of heap.objects()) {
            expect(tally.holdersOf(object.id)).toBe(
              countedIn([])(object) ? (held.get(object.id) ?? 0) : undefined,
            );
          }
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
          const heap = heapOf(initial);
          const given = heap.objects().map((object) => object.id);
          for (const step of changes) {
            if (step === undefined) {
              heap.keepOnly(new Set());
            } else if (step.kind === 'add') {
              given.push(heap.add((made) => step.make(made, [...given, made])).id);
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
