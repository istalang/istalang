/**
 * The heap's indexes against their definition, over random heaps changed by random adds, replaces
 * and removes: every lookup finds exactly what a scan of the heap's objects finds, in creation
 * order, and each kind's objects are listed in creation order.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FutureState } from '../../snapshot/objects.ts';
import { Heap, type LiveObject } from './heap.ts';

const ids = [0, 1, 2, 3, 4, 5];
const tokens = ['a', 'b'];
const id = fc.constantFrom(...ids);

const stateArbitrary = fc.oneof(
  fc.constant<FutureState>({ kind: 'resolved', value: null }),
  fc.constant<FutureState>({ kind: 'call' }),
  fc.constantFrom(...tokens).map((token): FutureState => ({ kind: 'host', token })),
  fc.bigInt({ min: 0n, max: 9n }).map((at): FutureState => ({ kind: 'timer', at })),
  fc
    .array(id, { minLength: 1, maxLength: 2 })
    .map((futures): FutureState => ({ kind: 'first', futures })),
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
);

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

/** Applies `step` to `heap`; a replace keeps its object's kind, so one of another kind is skipped. */
function apply(heap: Heap, step: Change): void {
  if (step.kind === 'add') {
    heap.add(step.make);
    return;
  }
  const objects = heap.objects();
  const target = objects[step.at % Math.max(1, objects.length)];
  if (target === undefined) {
    return;
  }
  if (step.kind === 'remove') {
    heap.remove(target.id);
    return;
  }
  const replacement = step.make(target.id);
  if (replacement.kind === target.kind) {
    heap.replace(replacement);
  }
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
          }
          for (const key of tokens) {
            expect(idsOf(heap.find('hostFutures', key))).toEqual(
              idsOf(futures.filter(({ state }) => state.kind === 'host' && state.token === key)),
            );
          }
          for (const key of ['timer', 'first'] as const) {
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
