/**
 * The heap's indexes against their definition, over random heaps changed by random adds, replaces
 * and removes: every lookup finds exactly what a scan of the heap's objects finds, in creation
 * order, and each kind's objects are listed in creation order. The objects written are those
 * replaced.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FutureState } from '../../snapshot/objects.ts';
import { Heap, type LiveObject, type LiveObjectOf } from './heap.ts';

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
          const heap = new Heap(initial.map((make, position) => make(position)));
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
          const heap = new Heap(initial.map((make, position) => make(position)));
          const replaced = changes.flatMap((step) => apply(heap, step) ?? []);
          expect(heap.takeWritten()).toEqual(replaced);
          expect(heap.takeWritten()).toEqual([]);
        },
      ),
    );
  });
});
