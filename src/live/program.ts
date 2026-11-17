/**
 * The runtime library's entry, `istalang/live`: a built program's module (`ista build`)
 * default-exports `program(…)` over its Definition, as definition/definition.ts embeds it, and its
 * code, which a host starts as any host starts a program (runtime/program.ts), on the std's natives.
 *
 * - The module brings its code, emitted once at build time, so starting it emits nothing again, and
 *   its Definition with its hash, the toolchain's own, so it is decoded alone: neither validated
 *   nor encoded again to key it.
 * - A start names a function by key, `main` without one, with its arguments as JSON and the host's
 *   externs written against JSON (`HostExterns`, runtime/boundary/host-natives.ts). What doesn't fit
 *   refuses it before anything runs.
 * - It settles at the run's end with how it ended, with the records it logged. It reaches no Node
 *   built-in, so a browser runs it as a process does: time is the platform's clock, and its seed
 *   the platform's random bytes unless the host gives one.
 */

import type { EmittedProgram } from '../codegen/emit.ts';
import { embeddedDefinition } from '../definition/definition.ts';
import type { HostExterns } from '../runtime/boundary/host-natives.ts';
import { type Clock, realTime } from '../runtime/clock.ts';
import type { LogRecord } from '../runtime/instance-state.ts';
import { type LiveEnd, startLive } from '../runtime/program.ts';
import { seedBytes } from '../runtime/random-draws.ts';
import { stdNatives } from '../stdlib/natives.ts';

/** What a host starts a program with. */
export interface LiveStart {
  /** The key of the function to start; `main` without one. */
  readonly function?: string;
  readonly arguments?: readonly unknown[];
  readonly externs?: HostExterns;
  /** The run's name, which `runtime.id()` reads. */
  readonly name?: string;
  readonly clock?: Clock;
  /** The secret seed of its random values, 32 bytes; random by default. */
  readonly seed?: Uint8Array;
}

/** How a run ended, with the records it logged. */
export type LiveEnded = LiveEnd & { readonly logs: readonly LogRecord[] };

export interface LiveProgram {
  /** The keys of the functions a host may start. */
  readonly starts: readonly string[];
  readonly start: (start?: LiveStart) => Promise<LiveEnded>;
}

/** The program a Definition's embedded `text` and its emitted `code` make, started by a host. */
export function program(text: string, code: EmittedProgram): LiveProgram {
  const keyed = embeddedDefinition(text);
  return {
    starts: keyed.definition.starts.map(({ key }) => key),
    start: async (start = {}) => {
      const seed = start.seed ?? crypto.getRandomValues(new Uint8Array(seedBytes));
      const { end, logs } = await startLive(
        keyed,
        {
          natives: stdNatives,
          ...(start.externs === undefined ? {} : { externs: start.externs }),
          clock: start.clock ?? realTime,
          seed: () => seed,
        },
        {
          ...(start.function === undefined ? {} : { key: start.function }),
          ...(start.arguments === undefined ? {} : { arguments: start.arguments }),
          ...(start.name === undefined ? {} : { instance: start.name }),
        },
        { code },
      );
      return { ...end, logs };
    },
  };
}
