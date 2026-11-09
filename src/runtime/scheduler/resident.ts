/**
 * An instance a runtime keeps in memory between host calls (spec §5): its last commit, and the
 * instance that committed it, which runs on from there instead of being restored for each segment.
 *
 * - The store holds every commit, so the instance held is only ever a faster way to the state its
 *   last commit describes (`Instance.continueFrom`): a runtime with nothing held, a fresh one on
 *   the same store included, makes it from that commit instead.
 * - A segment takes the instance to run on, so no other segment runs on it meanwhile: a segment
 *   that starts while another runs, as answering a mock's call inside the caller's segment may
 *   (§10), runs on an instance made from the last commit, as a host would see it. The taker gives
 *   it back with what it committed, or unchanged when nothing ran.
 * - What ran past the last commit and didn't commit, a panic's segment or the first run of a
 *   segment `crashEveryAwait` repeats, is never given back: the next segment starts from the
 *   commit, as a restart would (§3.12, §10).
 */

import type { Snapshot } from '../snapshot/snapshot.ts';
import { Instance } from './instance/index.ts';
import type { LoadedDefinition } from './loaded-definition.ts';

export class Resident<Loaded extends LoadedDefinition = LoadedDefinition> {
  /** The program the instance runs. */
  readonly loaded: Loaded;
  #committed: Snapshot;
  #held: Instance | undefined;

  constructor(loaded: Loaded, committed: Snapshot) {
    this.loaded = loaded;
    this.#committed = committed;
  }

  /** The instance's last commit, a new instance's `unstarted` snapshot before its first (§9). */
  get committed(): Snapshot {
    return this.#committed;
  }

  /**
   * The instance at its last commit, for one segment to run on: the one held, or else one made from
   * the commit, a new instance's root about to run its call.
   */
  take(): Instance {
    const held = this.#held;
    this.#held = undefined;
    if (held !== undefined) {
      return held;
    }
    return this.#committed.status.kind === 'unstarted'
      ? Instance.start(this.loaded, this.#committed)
      : Instance.restore(this.loaded, this.#committed);
  }

  /** Gives back `instance`, taken for a segment that found nothing to run. */
  giveBack(instance: Instance): void {
    this.#held = instance;
  }

  /** Records `snapshot`, which `instance` just committed, and runs on from it while it is active. */
  committedBy(instance: Instance, snapshot: Snapshot): void {
    this.#committed = snapshot;
    this.#held = undefined;
    if (snapshot.status.kind === 'active') {
      instance.continueFrom(snapshot);
      this.#held = instance;
    }
  }

  /** Records `snapshot`, committed with no instance running on from it, as a panic's is. */
  frozenAt(snapshot: Snapshot): void {
    this.#committed = snapshot;
    this.#held = undefined;
  }
}
