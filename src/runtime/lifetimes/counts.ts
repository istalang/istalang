/**
 * How many holders each counted object has (docs/work/static-lifetimes/design.md §9): no cycle
 * passes through an object that reaches a disposable (spec §7, "Cycles", which the checker
 * enforces), so such an object loses its last holder exactly when its count drops to zero.
 *
 * - **What is counted:** every disposable, every other object that may hold one (a future, a
 *   slot, a wait, a resolver, a mock), and a cell or resource whose type entry is `counted` or
 *   declares a disposal (`countsHoldersOf`). Roots are kept for their own sake, and a weak
 *   reference holds nothing, so neither is counted. Both runtimes count this way: the
 *   interpreter's heap (holder-writes.ts) and a run of compiled code (live/lifetimes/).
 * - **Holders** are what R2's seam reports (holder-writes.ts): registers, heap objects' fields and
 *   index edges, and the running calls' futures. Each report gives what the holder held and holds
 *   now; holding the new before letting go of the old keeps a count from passing through zero.
 * - **Every composite value is a node** (design.md §9.6): its holders count it, and it counts as
 *   one holder of each of its parts, from its first hold until its last holder lets go of it. So
 *   copying a value into another holder is one increment, never one per part inside, and a node
 *   held once is one an update may change in place (in-place.ts). Values are shared by identity
 *   across instances (constants, restores), so the nodes are this instance's own, keyed by identity.
 * - **A zero is only a candidate** until the step's end (`takeZeroes`): several paths let go of
 *   something before they hold it again, such as a resolver replaced before its `onCancel` runs are
 *   readied, or a run removed before the call it starts holds its captures.
 */

import type { TypeDefinition } from '../../definition/tables/types.ts';
import {
  type CompositeValue,
  childValues,
  isComposite,
  type Value,
} from '../../definition/values/values.ts';
import { pushAll } from '../../foundation/structures/stack.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { Held } from '../snapshot/holdings.ts';

/** Whether the holders of a cell or resource of type entry `type` are counted. */
export function countsHoldersOf(types: readonly TypeDefinition[], type: number): boolean {
  const entry = types[type];
  return entry?.kind === 'extern' && (entry.counted || entry.disposal.kind !== 'none');
}

export class Counts {
  /** Each counted object's holders. */
  readonly #objects = new Map<number, number>();
  /** Each composite's holders, while it has any. */
  readonly #nodes = new WeakMap<CompositeValue, number>();
  /** Counted objects that came to have no holder since the last `takeZeroes`. */
  readonly #zeroes = new Set<number>();
  /** Counted objects let go of since the last `takeLetGo`. */
  readonly #letGo: number[] = [];

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

  /** How many holders composite `node` has; undefined while nothing holds it. */
  holdersOfNode(node: CompositeValue): number | undefined {
    return this.#nodes.get(node);
  }

  /** `node`, changed in place, came to hold `part`: one more holder of it, once `node` is held. */
  partHeld(node: CompositeValue, part: Value): void {
    if (this.#nodes.has(node)) {
      this.#hold({ values: [part], holds: [] });
    }
  }

  /** `node`, changed in place, let go of `part`: one holder fewer, once `node` is held. */
  partReleased(node: CompositeValue, part: Value): void {
    if (this.#nodes.has(node)) {
      this.#release({ values: [part], holds: [] });
    }
  }

  /** The counted objects that have no holder now, of those that came to have none since last time. */
  takeZeroes(): readonly number[] {
    const zeroes = [...this.#zeroes].filter((id) => this.#objects.get(id) === 0);
    this.#zeroes.clear();
    return zeroes;
  }

  /** The counted objects let go of since the last call, each as often as it was. */
  takeLetGo(): readonly number[] {
    return this.#letGo.splice(0);
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
    this.#letGo.push(id);
    if (holders === 1) {
      this.#zeroes.add(id);
    }
  }
}
