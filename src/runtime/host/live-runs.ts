/**
 * The live runs a host's starts are running (§17.3): the program each runs and its options, and how
 * many the host started. None is ever persisted, so its name tells nothing of which start it is:
 * its random source is told apart from every other by the count of starts before it
 * (random-draws.ts `instanceSeed`), so two starts under one name draw apart.
 */

import type { StartOptions } from '../instance-state.ts';
import { instanceSeed } from '../random-draws.ts';
import type { Run } from '../run/run.ts';
import type { WorldProgram } from './resident.ts';

/** A live run a host's start is running: the program it runs, and its options. */
export interface LiveStart {
  readonly program: WorldProgram;
  readonly options: StartOptions;
}

export class LiveRuns {
  readonly #running = new Map<Run, LiveStart>();
  #started = 0;

  /** The seed of the next live run, named `name`, a host with the seed `hostSeed` starts. */
  nextSeed(hostSeed: Uint8Array, name: string): Uint8Array {
    const start = this.#started;
    this.#started = start + 1;
    return instanceSeed(hostSeed, { kind: 'live', name, start });
  }

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
