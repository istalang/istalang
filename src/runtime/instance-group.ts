/**
 * A group of instances a host drives together (§9): where each stands, as its last advance said,
 * an instance an advance spawned joining it ready. Every loop over such a group asks it the same
 * questions, which instance can run now, which timer is due first and which instances are due by a
 * time, so they are answered here once, for settle.ts and for a test's world (runtime/testing/).
 *
 * An instance can run now when it was spawned and hasn't run yet, or when it waits for the end of
 * an instance of the group that has ended (§9), since its next segment resolves that wait. Those
 * spawned come first, so a parent's children run before a wait on the parent wakes its watcher.
 */

import type { Advanced, InstanceState } from './instance-state.ts';
import { hasEnded } from './scheduler/instance-ends.ts';

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

  /**
   * An instance of the group that can run now: the first to join of those spawned and not run
   * yet, or else of those waiting for an end that has come.
   */
  ready(): string | undefined {
    const states = [...this.#states];
    const ready =
      states.find(([, state]) => state.kind === 'ready') ??
      states.find(([, state]) => this.#watchesAnEnd(state));
    return ready?.[0];
  }

  /** Whether `state` waits for the end of an instance of the group that has ended (§9). */
  #watchesAnEnd(state: InstanceState): boolean {
    return (
      state.kind === 'waiting' &&
      state.watching.some((watched) => {
        const end = this.#states.get(watched);
        return end !== undefined && hasEnded(end);
      })
    );
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
