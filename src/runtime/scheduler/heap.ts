/**
 * A running instance's heap: the objects handles point at, by id, with executions holding live
 * frames (spec §5). The scheduler's parts (futures.ts, slots.ts, instance/) read and change it.
 *
 * - Ids grow with creation, so id order is creation order (snapshot/objects.ts). Counting starts
 *   one past the highest id the heap was made with, so the next id is never stored; an id a commit
 *   freed may come back in a later segment, once nothing refers to it. A heap is made from objects
 *   in id order, as a snapshot keeps them, and adds each new one last, so iterating it is in id
 *   order too.
 * - Objects are immutable records, except an execution's frames, which the interpreter runs in
 *   place. Changing any other object replaces it.
 * - Replacing or removing an object notes the objects it held, as frames note what their
 *   registers let go (interpreter/machine.ts): each may have lost its last holder. The scheduler
 *   takes the notes after each instruction and collects (runtime/lifetimes/).
 * - Finding an object by a field is a lookup, not a scan: the heap indexes the fields its users
 *   find objects by (`indexes`), each key derived from the object alone. No key reads an
 *   execution's frames, the one part that changes in place, so `add`, `replace` and `remove`, the
 *   only ways to change the heap, keep every index exact. A heap made from a snapshot builds them,
 *   and none is persisted.
 */

import { handleTarget, type Value } from '../../definition/values.ts';
import { pushAll } from '../../structures/stack.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { ActiveFrame } from '../interpreter/machine.ts';
import { heldObjects } from '../snapshot/holdings.ts';
import type { HeapObject } from '../snapshot/objects.ts';

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
  /** Every execution, by the call future its return resolves: the root's, which has none, is undefined. */
  executions: index('execution', (execution) => [execution.resolves]),
  /** Each weak reference, by its referent while it has one. */
  weakRefs: index('weakRef', (weak) => (typeof weak.target === 'number' ? [weak.target] : [])),
  /** Each pending `disposed()` watch, by the weak reference it is on. */
  watches: index('future', ({ state }) => (state.kind === 'disposed' ? [state.weakRef] : [])),
  /** Each pending future its host fills, by its token. */
  hostFutures: index('future', ({ state }) => (state.kind === 'host' ? [state.token] : [])),
  /** Each pending timer, `first` and watch, by its state's kind. */
  pending: index('future', ({ state }) =>
    state.kind === 'timer' || state.kind === 'first' || state.kind === 'watch' ? [state.kind] : [],
  ),
  /** Each held mock, by the function it replaces. */
  mocks: index('mock', (mock) => [mock.target]),
  /** Each answer to another instance's call, by the future it waits on. */
  answers: index('answer', (answer) => [answer.future]),
};

type Indexes = typeof indexes;

type IndexName = keyof Indexes;

type IndexKey<Name extends IndexName> = ReturnType<Indexes[Name]['keys']>[number];

const indexNames = Object.keys(indexes) as IndexName[];

export class Heap {
  readonly #objects: Map<number, LiveObject>;
  #next: number;
  readonly #released: number[] = [];
  /** Each kind's objects, in creation order: a kind never changes, and ids only grow. */
  readonly #kinds = new Map<LiveKind, Set<number>>();
  readonly #indexes = new Map<IndexName, Map<unknown, Set<number>>>(
    indexNames.map((name) => [name, new Map()]),
  );

  constructor(objects: readonly LiveObject[]) {
    this.#objects = new Map(objects.map((object) => [object.id, object]));
    this.#next = Math.max(-1, ...this.#objects.keys()) + 1;
    for (const object of objects) {
      this.#enter(object);
    }
  }

  /** A new object, made by `make` with the next id. */
  add<Object extends LiveObject>(make: (id: number) => Object): Object {
    const object = make(this.#next);
    this.#next += 1;
    this.#objects.set(object.id, object);
    this.#enter(object);
    return object;
  }

  /** Object `id`, which must be of `kind`: a handle of the wrong kind is a bug the checker rules out. */
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
    this.#noteHoldings(old, object);
    this.#leave(old);
    this.#objects.set(object.id, object);
    this.#enter(object);
  }

  remove(id: number): void {
    const old = this.#objects.get(id);
    if (old !== undefined) {
      this.#noteHoldings(old);
      this.#leave(old);
      this.#kinds.get(old.kind)?.delete(id);
      this.#objects.delete(id);
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

  /** Notes that the objects `ids` may have lost their last holder. */
  noteReleased(ids: Iterable<number>): void {
    pushAll(this.#released, ids);
  }

  /** The objects that may have lost their last holder since the last call. */
  takeReleased(): readonly number[] {
    return this.#released.splice(0);
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

  /** Notes what `old`, an object being replaced or removed, held and its replacement doesn't. */
  #noteHoldings(old: LiveObject, replacement?: LiveObject): void {
    if (notesOwnReleases(old)) {
      return;
    }
    const kept = new Set(
      replacement === undefined || notesOwnReleases(replacement) ? [] : heldObjects(replacement),
    );
    this.noteReleased(heldObjects(old).filter((id) => !kept.has(id)));
  }
}

/**
 * Whether `object` notes its own releases as its registers change (interpreter/machine.ts), rather
 * than when the heap replaces or removes it, as every other object, an `answer` root included,
 * does.
 */
function notesOwnReleases(object: LiveObject): object is LiveExecution {
  return object.kind === 'execution';
}

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
