/**
 * A running instance's heap: the objects handles point at, by id, with executions holding live
 * frames (spec §5). The scheduler's parts (futures.ts, slots.ts, /) read and change it.
 *
 * - An id is a serial: the heap numbers the objects it makes in the order it makes them, counting
 *   on from the count its snapshot kept (`objectsMade`), so id order is creation order and no id is
 *   ever given twice, however many a commit lets go of (snapshot/objects.ts). A heap is made from
 *   objects in id order, as a snapshot keeps them, and adds each new one last, so iterating it is in
 *   id order too.
 * - Objects are immutable records, except an execution's frames, which the interpreter runs in
 *   place. Changing any other object replaces it.
 * - Every change of an object reports, as a holder write, what it held and what it holds now
 *   (runtime/lifetimes/holder-writes.ts), as frames report their registers (interpreter/
 *   registers.ts): what it holds through its fields and values, and the edges its indexes give it
 *   (`holds`), its own and those of the objects whose edges read it. Replacing one also notes it as
 *   written: only a write into an existing object can close a cycle, so a test's check of the heap
 *   walks from there (scheduler/loaded-definition.ts `HeapCheck`).
 * - Finding an object by a field is a lookup, not a scan: the heap indexes the fields its users
 *   find objects by (`indexes`), each key derived from the object alone. No key reads an
 *   execution's frames, the one part that changes in place, so `add`, `replace` and `remove`, the
 *   only ways to change the heap, keep every index exact. A heap made from a snapshot builds them,
 *   and none is persisted.
 */

import { handleTarget, type Value } from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { ActiveFrame } from '../../interpreter/frames.ts';
import type { HolderWrites } from '../../lifetimes/holder-writes.ts';
import {
  type Held,
  heldBy,
  idsHeld,
  isHeldFromRoot,
  nothingHeld,
} from '../../snapshot/holdings.ts';
import type { HeapObject } from '../../snapshot/objects.ts';
import {
  type Indexes,
  type IndexKey,
  type IndexName,
  indexes,
  indexNames,
  keysOf,
  readIndexes,
} from './heap-indexes.ts';

export interface LiveExecution {
  readonly kind: 'execution';
  readonly id: number;
  /** The future this execution's return resolves; the root, the instance's own, has none. */
  readonly resolves: number | undefined;
  /** The call stack, innermost frame last. */
  readonly frames: ActiveFrame[];
  readonly disposing: boolean;
}

/** A heap object as the running instance holds it. */
export type LiveObject = Exclude<HeapObject, { kind: 'execution' }> | LiveExecution;

export type LiveKind = LiveObject['kind'];

export type LiveObjectOf<Kind extends LiveKind> = Extract<LiveObject, { readonly kind: Kind }>;

export class Heap {
  readonly #objects = new Map<number, LiveObject>();
  readonly #holders: HolderWrites;
  #made: number;
  readonly #written: number[] = [];
  /** Each kind's objects, in creation order: a kind never changes, and ids only grow. */
  readonly #kinds = new Map<LiveKind, Set<number>>();
  readonly #indexes = new Map<IndexName, Map<unknown, Set<number>>>(
    indexNames.map((name) => [name, new Map()]),
  );

  /**
   * An empty heap that has made `made` objects so far, the next one's id, reporting its writes to
   * `holders`; a snapshot's objects go in through `restore`.
   */
  constructor(made: number, holders: HolderWrites) {
    this.#made = made;
    this.#holders = holders;
  }

  /**
   * Puts a snapshot's objects in this empty heap, in id order, each one it made already: every one
   * is in before any reports what it holds, as one may hold another made after it.
   */
  restore(objects: readonly LiveObject[]): void {
    if (this.#objects.size > 0) {
      unreachable('A heap is restored only while empty.');
    }
    const never = objects.find(({ id }) => id >= this.#made);
    if (never !== undefined) {
      unreachable(`Object ${never.id} was never made: only ${this.#made} were.`);
    }
    this.#write(objects.map((now) => ({ old: undefined, now })));
  }

  /** How many objects the heap has made: the id the next one gets. */
  get made(): number {
    return this.#made;
  }

  /** A new object, made by `make` with the next id. */
  add<Object extends LiveObject>(make: (id: number) => Object): Object {
    const object = make(this.#made);
    this.#made += 1;
    this.#write([{ old: undefined, now: object }]);
    return object;
  }

  /**
   * Object `id`, which must be of `kind`: a handle of the wrong kind is a bug the checker rules
   * out.
   */
  of<Kind extends LiveKind>(id: number, kind: Kind): LiveObjectOf<Kind> {
    const object = this.#objects.get(id);
    if (object?.kind !== kind) {
      unreachable(`Object ${id} is not a ${kind}.`);
    }
    return object as LiveObjectOf<Kind>;
  }

  /** Replaces the object with `object`'s id, which keeps its kind. */
  replace(object: LiveObject): void {
    const old = this.objectOf(object.id);
    if (old.kind !== object.kind) {
      unreachable(`Object ${object.id} is a ${old.kind}, not a ${object.kind}.`);
    }
    this.#write([{ old, now: object }]);
    this.#written.push(object.id);
  }

  remove(id: number): void {
    const old = this.#objects.get(id);
    if (old !== undefined) {
      this.#write([{ old, now: undefined }]);
    }
  }

  /**
   * Keeps only the objects `kept` names, those a commit persisted (§5), so the heap is the one made
   * from that commit's snapshot: it has nothing noted, as whatever a commit keeps is held.
   */
  keepOnly(kept: ReadonlySet<number>): void {
    this.#write(
      this.objects()
        .filter(({ id }) => !kept.has(id))
        .map((old) => ({ old, now: undefined })),
    );
    this.#written.length = 0;
    this.#holders.settled();
  }

  /**
   * Makes `changes`, each putting `now` in the place of `old`, either absent for an object made or
   * gone, and reports what each holder they change held and holds: each object written, its index
   * edges included, and each other object whose index edges read one (`#readers`). Every object
   * reported is in the heap as it is: one made goes in, and is reported made, before any report,
   * and one gone leaves, and is reported gone, only after them all.
   */
  #write(changes: readonly ObjectChange[]): void {
    const written = new Set(changes.map(({ old, now }) => (old ?? now)?.id));
    const readers = this.#readers(changes.flatMap(({ old, now }) => [old, now]))
      .filter((id) => !written.has(id))
      .map((id) => ({ id, before: this.#indexedHeld(id) }));
    const was = changes.map(({ old }) => (old === undefined ? nothingHeld : this.#held(old)));
    for (const { old, now } of changes) {
      if (old !== undefined) {
        this.#leave(old);
      }
      if (now !== undefined) {
        this.#objects.set(now.id, now);
        this.#enter(now);
        if (old === undefined) {
          this.#holders.made(now);
        }
      }
    }
    changes.forEach(({ now }, position) => {
      this.#holders.changed(
        was[position] ?? nothingHeld,
        now === undefined ? nothingHeld : this.#held(now),
      );
    });
    for (const { id, before } of readers) {
      this.#holders.changed(before, this.#indexedHeld(id));
    }
    for (const { old, now } of changes) {
      if (old !== undefined && now === undefined) {
        this.#kinds.get(old.kind)?.delete(old.id);
        this.#objects.delete(old.id);
        this.#holders.gone(old.id);
      }
    }
  }

  /** The objects index `name` holds under `key`, in creation order. */
  find<Name extends IndexName>(
    name: Name,
    key: IndexKey<Name>,
  ): readonly LiveObjectOf<Indexes[Name]['kind']>[] {
    const kind: Indexes[Name]['kind'] = indexes[name].kind;
    const ids = this.#indexes.get(name)?.get(key) ?? [];
    return [...ids].sort((first, second) => first - second).map((id) => this.of(id, kind));
  }

  /** The objects replaced since the last call: written into, so maybe closing a cycle. */
  takeWritten(): readonly number[] {
    return this.#written.splice(0);
  }

  /** How many holders counted object `id` has (runtime/lifetimes/counts.ts); undefined if uncounted. */
  holdersOf(id: number): number | undefined {
    return this.#holders.holdersOf(id);
  }

  /** Whether the object with `id` exists. */
  has(id: number): boolean {
    return this.#objects.has(id);
  }

  /** Object `id`, of whatever kind; a missing one is a bug. */
  objectOf(id: number): LiveObject {
    const object = this.#objects.get(id);
    if (object === undefined) {
      unreachable(`No object ${id}.`);
    }
    return object;
  }

  /** Every object, in creation order. */
  objects(): readonly LiveObject[] {
    return [...this.#objects.values()];
  }

  /** Every object of `kind`, in creation order. */
  objectsOf<Kind extends LiveKind>(kind: Kind): readonly LiveObjectOf<Kind>[] {
    return [...(this.#kinds.get(kind) ?? [])].map((id) => this.of(id, kind));
  }

  /** Files a new or replacing `object` under its kind and its keys. */
  #enter(object: LiveObject): void {
    const ofKind = this.#kinds.get(object.kind) ?? new Set();
    this.#kinds.set(object.kind, ofKind.add(object.id));
    for (const [name, key] of keysOf(object)) {
      const byKey = this.#indexes.get(name);
      byKey?.set(key, (byKey.get(key) ?? new Set()).add(object.id));
    }
  }

  /** Takes `object`, being replaced or removed, out from under its keys. */
  #leave(object: LiveObject): void {
    for (const [name, key] of keysOf(object)) {
      const byKey = this.#indexes.get(name);
      const ids = byKey?.get(key);
      ids?.delete(object.id);
      if (ids?.size === 0) {
        byKey?.delete(key);
      }
    }
  }

  /**
   * The ids of the objects `object` holds (spec §7, proposal 8, Rule 5): what its fields and values
   * hold (snapshot/holdings.ts), and what it holds through the indexes, one end of each
   * registration, as the resolver's chain's root says (`isHeldFromRoot`). A wait holds its case
   * resolvers, and a pending resolver of a case's chain its `Resolver.at` ones, that are awaited:
   * registered, or decided by `Resolver.at` ones of their own. A future holds the pending resolvers
   * of callbacks' chains registered on it. So what an awaitable started for a wait lives as long as
   * the wait, a callback as long as its future, and what lost is let go of as it loses, while a
   * resolver nothing awaits is let go of when its holder drops it.
   */
  holds(object: Exclude<LiveObject, LiveExecution>): readonly number[] {
    return idsHeld(this.#held(object));
  }

  /**
   * What `object` holds (`holds`), as its writes report it; an execution, nothing of its own: its
   * frames' registers report their writes themselves (interpreter/registers.ts).
   */
  #held(object: LiveObject): Held {
    if (object.kind === 'execution') {
      return nothingHeld;
    }
    const held = heldBy(object);
    const indexed = this.#indexedHolds(object);
    return indexed.length === 0
      ? held
      : { values: held.values, holds: [...held.holds, ...indexed] };
  }

  /** What object `reader` holds through the indexes, as a holder of those edges; nothing once gone. */
  #indexedHeld(reader: number): Held {
    const object = this.#objects.get(reader);
    return object === undefined || object.kind === 'execution'
      ? nothingHeld
      : { values: [], holds: this.#indexedHolds(object) };
  }

  /**
   * The objects whose index edges read any of `objects` (`#indexedHolds`): for a resolver, the
   * futures it is registered on, its case's wait, or the resolver it decides, and, as whether that
   * one is awaited may change with it, what reads that one in turn.
   */
  #readers(objects: readonly (LiveObject | undefined)[]): readonly number[] {
    const readers = new Set<number>();
    const reading = objects.filter((object) => object !== undefined);
    for (let object = reading.pop(); object !== undefined; object = reading.pop()) {
      for (const [name, key] of keysOf(object)) {
        if (readIndexes.has(name) && typeof key === 'number' && !readers.has(key)) {
          readers.add(key);
          const reader = this.#objects.get(key);
          if (reader?.kind === 'resolver') {
            reading.push(reader);
          }
        }
      }
    }
    return [...readers];
  }

  /** What `object` holds through the indexes (`holds`). */
  #indexedHolds(object: Exclude<LiveObject, LiveExecution>): readonly number[] {
    if (object.kind === 'future') {
      return this.find('resolvers', object.id).flatMap(({ id, state }) =>
        state.kind === 'pending' && !isHeldFromRoot(state.target) ? [id] : [],
      );
    }
    if (object.kind === 'wait') {
      return this.#awaited(this.find('cases', object.id));
    }
    return object.kind === 'resolver' &&
      object.state.kind === 'pending' &&
      isHeldFromRoot(object.state.target)
      ? this.#awaited(this.find('positions', object.id))
      : [];
  }

  /** The ids of those of `resolvers` that are awaited (`holds`). */
  #awaited(resolvers: readonly LiveObjectOf<'resolver'>[]): readonly number[] {
    return resolvers.flatMap(({ id, state }) =>
      state.kind === 'pending' &&
      (state.on.length > 0 || this.#awaited(this.find('positions', id)).length > 0)
        ? [id]
        : [],
    );
  }
}

/** One change of the heap: `now` in the place of `old`, either absent for an object made or gone. */
interface ObjectChange {
  readonly old: LiveObject | undefined;
  readonly now: LiveObject | undefined;
}

/** The object `handle` names; anything else is a bug the checker rules out. */
export function handleObject(handle: Value): number {
  const id = handleTarget(handle);
  if (id === undefined) {
    unreachable('Expected a handle.');
  }
  return id;
}
