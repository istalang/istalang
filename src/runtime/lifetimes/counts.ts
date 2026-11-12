/**
 * How many holders each counted object has (docs/work/static-lifetimes/design.md §9): no cycle
 * passes through an object that reaches a disposable (spec §7, "Cycles", which the checker
 * enforces), so such an object loses its last holder exactly when its count drops to zero.
 *
 * - **What is counted:** every disposable, every other object that may hold one (a future, a
 *   slot, a wait, a resolver, a mock), and a cell or resource whose type entry is `counted` or
 *   declares a disposal (`countedIn`). Roots are kept for their own sake, and a weak reference
 *   holds nothing, so neither is counted.
 * - **Holders** are what R2's seam reports (holder-writes.ts): registers, heap objects' fields and
 *   index edges, and the running calls' futures. Each report gives what the holder held and holds
 *   now; holding the new before letting go of the old keeps a count from passing through zero.
 * - **A composite value is a node** once it holds a counted part, at any depth: its holders count
 *   it, and it counts as one holder of each of its parts. So copying a value into another holder
 *   is one increment, never one per handle inside. Whether a composite holds a counted part is
 *   decided at its first hold, since natives build values with no instance at hand, and kept for
 *   good, as a value never changes and neither does whether an object is counted. Values are
 *   shared by identity across instances (constants, restores), so the nodes are this instance's
 *   own, keyed by identity.
 * - **A zero is only a candidate** until the step's end (`takeZeroes`): several paths let go of
 *   something before they hold it again, such as a resolver replaced before its `onCancel` runs are
 *   readied, or a run removed before the call it starts holds its captures.
 */

import type { TypeDefinition } from '../../definition/tables/types.ts';
import {
  type CompositeValue,
  childValues,
  handlesIn,
  isComposite,
  type Value,
} from '../../definition/values/values.ts';
import { pushAll } from '../../foundation/structures/stack.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { LiveObject } from '../scheduler/instance/heap.ts';
import { type Held, isRoot } from '../snapshot/holdings.ts';

/** Whether the runtime counts `object`'s holders, given the Definition's `types`. */
export function countedIn(types: readonly TypeDefinition[]): (object: LiveObject) => boolean {
  return (object) => {
    if (isRoot(object) || object.kind === 'weakRef') {
      return false;
    }
    if (object.kind !== 'cell' && object.kind !== 'resource') {
      return true;
    }
    const entry = types[object.type];
    return entry?.kind === 'extern' && (entry.counted || entry.disposal.kind !== 'none');
  };
}

export class Counts {
  /** Each counted object's holders. */
  readonly #objects = new Map<number, number>();
  /** Each counted composite's holders, while it has any. */
  readonly #nodes = new WeakMap<CompositeValue, number>();
  /** Whether each composite seen holds a counted part, at any depth. */
  readonly #counted = new WeakMap<CompositeValue, boolean>();
  /** Counted objects that came to have no holder since the last `takeZeroes`. */
  readonly #zeroes = new Set<number>();

  /** Counted object `id` was made, held by nothing yet. */
  made(id: number): void {
    this.#objects.set(id, 0);
    this.#zeroes.add(id);
  }

  /** Object `id` is gone, its holders forgotten. */
  gone(id: number): void {
    this.#objects.delete(id);
    this.#zeroes.delete(id);
  }

  /** A holder that held `was` holds `now`. */
  changed(was: Held, now: Held): void {
    this.#hold(now);
    this.#release(was);
  }

  /** How many holders counted object `id` has; undefined for one not counted. */
  holdersOf(id: number): number | undefined {
    return this.#objects.get(id);
  }

  /** Whether some counted object came to have no holder since the last `takeZeroes`. */
  get zeroed(): boolean {
    return this.#zeroes.size > 0;
  }

  /** The counted objects that have no holder now, of those that came to have none since last time. */
  takeZeroes(): readonly number[] {
    const zeroes = [...this.#zeroes].filter((id) => this.#objects.get(id) === 0);
    this.#zeroes.clear();
    return zeroes;
  }

  #hold({ values, holds }: Held): void {
    for (const id of holds) {
      this.#holdObject(id);
    }
    const pending: Value[] = [...values];
    for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
      pushAll(pending, this.#holdValue(value));
    }
  }

  #release({ values, holds }: Held): void {
    for (const id of holds) {
      this.#releaseObject(id);
    }
    const pending: Value[] = [...values];
    for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
      pushAll(pending, this.#releaseValue(value));
    }
  }

  /** Holds `value` once more; its parts, which its first hold holds in turn. */
  #holdValue(value: Value): readonly Value[] {
    if (!isComposite(value)) {
      return [];
    }
    if (value.kind === 'handle') {
      this.#holdObject(value.object);
      return [];
    }
    const holders = this.#nodes.get(value);
    if (holders !== undefined) {
      this.#nodes.set(value, holders + 1);
      return [];
    }
    if (!this.#holdsCounted(value)) {
      return [];
    }
    this.#nodes.set(value, 1);
    return childValues(value);
  }

  /** Lets go of `value` once; its parts, which its last holder letting go of lets go of in turn. */
  #releaseValue(value: Value): readonly Value[] {
    if (!isComposite(value)) {
      return [];
    }
    if (value.kind === 'handle') {
      this.#releaseObject(value.object);
      return [];
    }
    const holders = this.#nodes.get(value);
    if (holders === undefined) {
      return [];
    }
    if (holders > 1) {
      this.#nodes.set(value, holders - 1);
      return [];
    }
    this.#nodes.delete(value);
    return childValues(value);
  }

  #holdObject(id: number): void {
    const holders = this.#objects.get(id);
    if (holders !== undefined) {
      this.#objects.set(id, holders + 1);
    }
  }

  #releaseObject(id: number): void {
    const holders = this.#objects.get(id);
    if (holders === undefined) {
      return;
    }
    if (holders === 0) {
      unreachable(`Object ${id} was let go of by more holders than held it.`);
    }
    this.#objects.set(id, holders - 1);
    if (holders === 1) {
      this.#zeroes.add(id);
    }
  }

  /** Whether `composite` holds a counted object, at any depth: decided once, parts first. */
  #holdsCounted(composite: CompositeValue): boolean {
    const known = this.#counted.get(composite);
    if (known !== undefined) {
      return known;
    }
    if (handlesIn(composite).length === 0) {
      this.#counted.set(composite, false);
      return false;
    }
    const pending = [composite];
    for (let top = pending.at(-1); top !== undefined; top = pending.at(-1)) {
      const parts = childValues(top).filter(isComposite);
      const undecided = parts.filter((part) => part.kind !== 'handle' && !this.#counted.has(part));
      if (this.#counted.has(top) || undecided.length === 0) {
        pending.pop();
        this.#counted.set(
          top,
          parts.some((part) =>
            part.kind === 'handle' ? this.#objects.has(part.object) : this.#counted.get(part),
          ),
        );
      } else {
        pushAll(pending, undecided);
      }
    }
    return this.#counted.get(composite) === true;
  }
}
