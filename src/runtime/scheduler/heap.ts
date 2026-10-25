/**
 * A running instance's heap: the objects handles point at, by id, with executions holding live
 * frames (spec §5). The scheduler's parts (futures.ts, slots.ts, instance.ts) read and change it.
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
 */

import { handleTarget, type Value } from '../../definition/values.ts';
import { pushAll } from '../../structures/stack.ts';
import type { ActiveFrame } from '../interpreter/machine.ts';
import type { HeapObject } from '../snapshot/objects.ts';
import { heldObjects } from '../snapshot/snapshot.ts';

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
  readonly #objects: Map<number, LiveObject>;
  #next: number;
  readonly #released: number[] = [];

  constructor(objects: readonly LiveObject[]) {
    this.#objects = new Map(objects.map((object) => [object.id, object]));
    this.#next = Math.max(-1, ...this.#objects.keys()) + 1;
  }

  /** A new object, made by `make` with the next id. */
  add<Object extends LiveObject>(make: (id: number) => Object): Object {
    const object = make(this.#next);
    this.#next += 1;
    this.#objects.set(object.id, object);
    return object;
  }

  /** Object `id`, which must be of `kind`: a handle of the wrong kind is a bug the checker rules out. */
  of<Kind extends LiveKind>(id: number, kind: Kind): LiveObjectOf<Kind> {
    const object = this.#objects.get(id);
    if (object?.kind !== kind) {
      throw new Error(`Object ${id} is not a ${kind}.`);
    }
    return object as LiveObjectOf<Kind>;
  }

  /** Replaces the object with `object`'s id. */
  replace(object: LiveObject): void {
    this.#noteHoldings(this.#objects.get(object.id), object);
    this.#objects.set(object.id, object);
  }

  remove(id: number): void {
    this.#noteHoldings(this.#objects.get(id));
    this.#objects.delete(id);
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
      throw new Error(`No object ${id}.`);
    }
    return object;
  }

  /** Every object, in creation order. */
  objects(): readonly LiveObject[] {
    return [...this.#objects.values()];
  }

  /** Every object of `kind`, in creation order. */
  objectsOf<Kind extends LiveKind>(kind: Kind): readonly LiveObjectOf<Kind>[] {
    return this.objects().filter((object): object is LiveObjectOf<Kind> => object.kind === kind);
  }

  /** Notes what `old`, an object being replaced or removed, held and its replacement doesn't. */
  #noteHoldings(old: LiveObject | undefined, replacement?: LiveObject): void {
    if (old === undefined || old.kind === 'execution') {
      return;
    }
    const kept = new Set(
      replacement === undefined || replacement.kind === 'execution' ? [] : heldObjects(replacement),
    );
    this.noteReleased(heldObjects(old).filter((id) => !kept.has(id)));
  }
}

/** The object `handle` names; anything else is a bug the checker rules out. */
export function handleObject(handle: Value): number {
  const id = handleTarget(handle);
  if (id === undefined) {
    throw new TypeError('Expected a handle.');
  }
  return id;
}
