/**
 * A group of instances a host drives together (§9): where each stands, as its last advance said,
 * an instance an advance spawned joining it ready. Every loop over such a group asks it the same
 * questions, which instance is ready, which timer is due first and which instances are due by a
 * time, so they are answered here once, for settle.ts and for a test's world (runtime/testing/).
 */

import type { Advanced, InstanceState } from './instance-state.ts';

export class InstanceGroup {
  readonly #states = new Map<string, InstanceState>();

  /** Where each instance of the group stands, in the order they joined it. */
  get states(): ReadonlyMap<string, InstanceState> {
    return this.#states;
  }

  /** Records where `instance` stands after `advanced`, and the instances it spawned, ready. */
  record(instance: string, { state, spawned }: Advanced): void {
    this.#states.set(instance, state);
    for (const child of spawned) {
      if (!this.#states.has(child)) {
        this.#states.set(child, { kind: 'ready' });
      }
    }
  }

  /** An instance of the group ready to run now, the first to join. */
  ready(): string | undefined {
    return [...this.#states].find(([, state]) => state.kind === 'ready')?.[0];
  }

  /** Whether some instance of the group waits. */
  waits(): boolean {
    return [...this.#states.values()].some((state) => state.kind === 'waiting');
  }

  /** The earliest time an instance of the group waits until; undefined when none waits on a timer. */
  earliestTimer(): bigint | undefined {
    let earliest: bigint | undefined;
    for (const state of this.#states.values()) {
      if (state.kind === 'waiting' && state.until !== undefined) {
        earliest = earliest === undefined || state.until < earliest ? state.until : earliest;
      }
    }
    return earliest;
  }

  /** The instances of the group whose next timer is due by `due`; none when no time was waited. */
  dueBy(due: bigint | undefined): readonly string[] {
    return [...this.#states].flatMap(([instance, state]) =>
      due !== undefined &&
      state.kind === 'waiting' &&
      state.until !== undefined &&
      state.until <= due
        ? [instance]
        : [],
    );
  }
}
