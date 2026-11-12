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

/** A field the heap finds objects of `kind` by: each such object's keys, derived from it alone. */
interface Index<Kind extends LiveKind, Key> {
  readonly kind: Kind;
  readonly keys: (object: LiveObjectOf<Kind>) => readonly Key[];
}

function index<Kind extends LiveKind, Key>(
  kind: Kind,
  keys: (object: LiveObjectOf<Kind>) => readonly Key[],
): Index<Kind, Key> {
  return { kind, keys };
}

const indexes = {
  /**
   * Every execution, by the call future its return resolves: the root's, which has none, is
   * undefined.
   */
  executions: index('execution', (execution) => [execution.resolves]),
  /** Each weak reference, by its referent while it has one. */
  weakRefs: index('weakRef', (weak) => (typeof weak.target === 'number' ? [weak.target] : [])),
  /** Each pending `disposed()` watch, by the weak reference it is on. */
  watches: index('future', ({ state }) => (state.kind === 'disposed' ? [state.weakRef] : [])),
  /** Each pending future filled from outside, a mock's answer or a host's promise, by its token. */
  hostFutures: index('future', ({ state }) => (state.kind === 'host' ? [state.token] : [])),
  /** Each pending timer, watch and future filled from outside, by its state's kind. */
  pending: index('future', ({ state }) =>
    state.kind === 'timer' || state.kind === 'watch' || state.kind === 'host' ? [state.kind] : [],
  ),
  /** Each held mock, by the function it replaces. */
  mocks: index('mock', (mock) => [mock.target]),
  /** Each answer to another instance's call, by the future it waits on. */
  answers: index('answer', (answer) => [answer.future]),
  /** Each pending resolver registered on a future, by every future it is registered on. */
  resolvers: index('resolver', ({ state }) => (state.kind === 'pending' ? state.on : [])),
  /** Each pending resolver of a wait's case, by that wait. */
  cases: index('resolver', ({ state }) =>
    state.kind === 'pending' && state.target.kind === 'case' ? [state.target.wait] : [],
  ),
  /** Each context constant's value, by the constant's qualified name (spec §3.4). */
  contextConstants: index('contextConstant', (constant) => [constant.key]),
  /** Each pending `Resolver.at` resolver, by the resolver it decides. */
  positions: index('resolver', ({ state }) =>
    state.kind === 'pending' && state.target.kind === 'at' ? [state.target.done] : [],
  ),
};

type Indexes = typeof indexes;

type IndexName = keyof Indexes;

type IndexKey<Name extends IndexName> = ReturnType<Indexes[Name]['keys']>[number];

const indexNames = Object.keys(indexes) as IndexName[];

export class Heap {
  readonly #objects: Map<number, LiveObject>;
  readonly #holders: HolderWrites;
  #made: number;
  readonly #written: number[] = [];
  /** Each kind's objects, in creation order: a kind never changes, and ids only grow. */
  readonly #kinds = new Map<LiveKind, Set<number>>();
  readonly #indexes = new Map<IndexName, Map<unknown, Set<number>>>(
    indexNames.map((name) => [name, new Map()]),
  );

  /**
   * The heap holding `objects`, in id order, having made `made` objects so far: the next one's id.
   * What each holds is reported to `holders`, as made here.
   */
  constructor(objects: readonly LiveObject[], made: number, holders: HolderWrites) {
    this.#objects = new Map();
    this.#made = made;
    this.#holders = holders;
    for (const object of objects) {
      if (object.id >= made) {
        unreachable(`Object ${object.id} was never made: only ${made} were.`);
      }
      this.#write(undefined, object);
    }
  }

  /** How many objects the heap has made: the id the next one gets. */
  get made(): number {
    return this.#made;
  }

  /** A new object, made by `make` with the next id. */
  add<Object extends LiveObject>(make: (id: number) => Object): Object {
    const object = make(this.#made);
    this.#made += 1;
    this.#write(undefined, object);
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
    this.#write(old, object);
    this.#written.push(object.id);
  }

  remove(id: number): void {
    const old = this.#objects.get(id);
    if (old !== undefined) {
      this.#write(old, undefined);
    }
  }

  /**
   * Keeps only the objects `kept` names, those a commit persisted (§5), so the heap is the one made
   * from that commit's snapshot: it has nothing noted, as whatever a commit keeps is held.
   */
  keepOnly(kept: ReadonlySet<number>): void {
    for (const object of this.objects()) {
      if (!kept.has(object.id)) {
        this.#write(object, undefined);
      }
    }
    this.#written.length = 0;
    this.#holders.settled();
  }

  /**
   * Puts `now` in the place of `old`, either absent for an object made or gone, and reports what
   * each holder it changes held and holds: the object itself, its index edges included, and the
   * other objects whose index edges read it (`#readers`).
   */
  #write(old: LiveObject | undefined, now: LiveObject | undefined): void {
    const written = (old ?? now)?.id;
    const readers = this.#readers([old, now])
      .filter((id) => id !== written)
      .map((id) => ({ id, before: this.#indexedHeld(id) }));
    const was = old === undefined ? nothingHeld : this.#held(old);
    if (old !== undefined) {
      this.#leave(old);
    }
    if (now === undefined) {
      if (old !== undefined) {
        this.#kinds.get(old.kind)?.delete(old.id);
        this.#objects.delete(old.id);
      }
    } else {
      this.#objects.set(now.id, now);
      this.#enter(now);
    }
    this.#holders.changed(was, now === undefined ? nothingHeld : this.#held(now));
    for (const { id, before } of readers) {
      this.#holders.changed(before, this.#indexedHeld(id));
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

/** The indexes `Heap.#indexedHolds` finds a holder's edges by, each keyed by that holder's id. */
const readIndexes: ReadonlySet<IndexName> = new Set(['resolvers', 'cases', 'positions']);

/** Every key `object` has, with the index it has it in. */
function keysOf(object: LiveObject): readonly (readonly [IndexName, unknown])[] {
  return indexNames.flatMap((name) => {
    const { kind, keys } = indexes[name] as Index<LiveKind, unknown>;
    return kind === object.kind ? keys(object).map((key) => [name, key] as const) : [];
  });
}

/** The object `handle` names; anything else is a bug the checker rules out. */
export function handleObject(handle: Value): number {
  const id = handleTarget(handle);
  if (id === undefined) {
    unreachable('Expected a handle.');
  }
  return id;
}
