/** The live runs a host's starts are running (§9): the program each runs and its options. */

import type { StartOptions } from '../instance-state.ts';
import type { Run } from '../run/run.ts';
import type { WorldProgram } from './resident.ts';

/** A live run a host's start is running: the program it runs, and its options. */
export interface LiveStart {
  readonly program: WorldProgram;
  readonly options: StartOptions;
}

export class LiveRuns {
  readonly #running = new Map<Run, LiveStart>();

  /** Has `run` run as `start` says, until it ends. */
  began(run: Run, start: LiveStart): void {
    this.#running.set(run, start);
  }

  /** Lets go of `run`, which ended. */
  ended(run: Run): void {
    this.#running.delete(run);
  }

  /** How `run` started, while it runs; undefined for any other run. */
  of(run: Run): LiveStart | undefined {
    return this.#running.get(run);
  }

  /** The live runs running now, in the order they started. */
  get runs(): readonly Run[] {
    return [...this.#running.keys()];
  }
}
