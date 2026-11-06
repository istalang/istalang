/**
 * The weak side's rules (spec §6, §7) over random sequences of events on a call and a few other
 * disposables: each referent has one weak reference; once a disposable is disposed, `deref` gives
 * nothing and every watch has resolved, whenever it was taken; a call's watches resolve when it
 * is disposed, and never once it has returned.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Value } from '../../definition/values/values.ts';
import { handleTo } from '../../definition/values/values.ts';
import { ignoredEvents } from './futures.test-kit.ts';
import { Futures } from './futures.ts';
import { Heap, type LiveExecution } from './heap.ts';
import { WeakSide } from './weak-side.ts';

const referents = 3;

type Event =
  | { readonly kind: 'watch'; readonly referent: number }
  | { readonly kind: 'dispose'; readonly referent: number }
  | { readonly kind: 'return'; readonly referent: number };

const event: fc.Arbitrary<Event> = fc.record({
  kind: fc.constantFrom('watch' as const, 'dispose' as const, 'return' as const),
  referent: fc.nat({ max: referents - 1 }),
});

/** Referents 0…n-1 and their weak references: 0 is a call, the others slots standing for any disposable. */
class Scene {
  readonly heap = new Heap([]);
  readonly futures = new Futures(this.heap, ignoredEvents);
  readonly weak = new WeakSide(this.heap, this.futures);
  readonly call = this.heap.add(
    (id): LiveExecution => ({
      kind: 'execution',
      id,
      resolves: undefined,
      frames: [],
      disposing: false,
    }),
  );
  readonly ids = [
    this.call.id,
    ...Array.from({ length: referents - 1 }, () =>
      this.heap.add((id) => ({ kind: 'slot', id, waiting: [] })),
    ).map(({ id }) => id),
  ];
  readonly references = this.ids.map((id) => this.weak.reference(handleTo(id)));
  readonly watches: {
    readonly referent: number;
    readonly future: Value;
    readonly late: boolean;
  }[] = [];
  readonly ended = new Map<number, 'disposed' | 'returned'>();

  play({ kind, referent }: Event): void {
    if (kind === 'watch') {
      this.#watch(referent);
    } else if (!this.ended.has(referent) && (referent === 0 || kind === 'dispose')) {
      this.#end(kind, referent);
    }
  }

  #watch(referent: number): void {
    const reference = this.references[referent] ?? null;
    const future = this.weak.watch(reference);
    this.watches.push({ referent, future, late: this.ended.has(referent) });
  }

  #end(kind: 'dispose' | 'return', referent: number): void {
    this.ended.set(referent, kind === 'dispose' ? 'disposed' : 'returned');
    const id = this.ids[referent] ?? -1;
    if (kind === 'return') {
      this.weak.onReturned(id);
    } else if (referent === 0) {
      this.weak.disposing(this.call);
    } else {
      this.weak.disposed(id);
    }
  }
}

/** Plays `events` on a new scene. */
function play(events: readonly Event[]): Scene {
  const scene = new Scene();
  for (const each of events) {
    scene.play(each);
  }
  return scene;
}

describe('the weak side', () => {
  it('gives each referent one weak reference', () => {
    const heap = new Heap([]);
    const weak = new WeakSide(heap, new Futures(heap, ignoredEvents));
    const [first, second] = [0, 1].map(
      () => heap.add((id) => ({ kind: 'slot', id, waiting: [] })).id,
    );
    expect(weak.reference(handleTo(first ?? -1))).toEqual(weak.reference(handleTo(first ?? -1)));
    expect(weak.reference(handleTo(first ?? -1))).not.toEqual(
      weak.reference(handleTo(second ?? -1)),
    );
  });

  it('lets go of a referent once it is disposed or its call returned, and only then', () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 20 }), (events) => {
        const { weak, references, ended } = play(events);
        for (const [referent, reference] of references.entries()) {
          expect(weak.target(reference) === undefined).toBe(ended.has(referent));
        }
      }),
    );
  });

  it('resolves the watches of what is disposed, a call only those taken while it ran', () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 20 }), (events) => {
        const { futures, watches, ended } = play(events);
        for (const { referent, future, late } of watches) {
          const disposed = ended.get(referent) === 'disposed';
          const resolves = disposed && (referent !== 0 || !late);
          expect(futures.settled(future) !== undefined).toBe(resolves);
        }
      }),
    );
  });
});
