/**
 * The runtime library's entry, `istalang/live` (docs/work/js-codegen/design.md, "Host API"): a
 * compiled program's module default-exports `program(…)` over its tables, which a host starts as
 * it starts a Definition's live code on the interpreter (runtime/host/index.ts).
 *
 * - A start names a function by key, `main` without one, with its arguments as JSON and the host's
 *   externs written against JSON (`HostExterns`, runtime/boundary/host-natives.ts). What doesn't
 *   fit refuses it before anything runs: an unknown key, the wrong number of arguments, JSON that
 *   doesn't fit, an extern no native implements, or a host extern the std implements itself.
 * - It settles at the run's end with how it ended: its outcome as JSON a host works with and as
 *   text, or its panic and trace, and the records it logged. An outcome JSON can't hold (§9), or a
 *   bug in the toolchain, rejects it.
 */

import { unreachable } from '../foundation/structures/unreachable.ts';
import { type HostExterns, withHost } from '../runtime/boundary/host-natives.ts';
import { outcomeJson, outcomeText } from '../runtime/boundary/outbound.ts';
import { jsonIn, startOf } from '../runtime/boundary/starts.ts';
import { type Clock, realTime } from '../runtime/clock.ts';
import type { LogRecord } from '../runtime/instance-state.ts';
import { type Natives, requireNatives } from '../runtime/natives.ts';
import { seedBytes, seedOf } from '../runtime/random-draws.ts';
import { stdNatives } from '../stdlib/natives.ts';
import { type LiveProgramTables, Run, type RunEnd } from './run.ts';

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
export type LiveEnded = (
  | { readonly kind: 'finished'; readonly outcome: unknown; readonly text: string }
  | { readonly kind: 'panicked'; readonly message: string; readonly trace: string }
) & { readonly logs: readonly LogRecord[] };

export interface LiveProgram {
  /** The keys of the functions a host may start. */
  readonly starts: readonly string[];
  readonly start: (start?: LiveStart) => Promise<LiveEnded>;
}

/** The program `tables` describe, started by a host. */
export function program(tables: LiveProgramTables): LiveProgram {
  return {
    starts: tables.starts.map(({ key }) => key),
    start: (start = {}) => {
      const given = start.arguments ?? [];
      const { entry, encoder } = startOf(tables, start.function, given.length);
      const values = given.map((json) => jsonIn(tables, json));
      const natives = nativesOf(tables, start.externs ?? {});
      return new Promise((resolve, reject) => {
        const run = new Run({
          program: tables,
          natives,
          clock: start.clock ?? realTime,
          name: start.name ?? 'run',
          seed: seedOf(start.seed ?? crypto.getRandomValues(new Uint8Array(seedBytes))),
          ended: (end) => {
            try {
              resolve(endedOf(tables, end, run.logs));
            } catch (error) {
              reject(error);
            }
          },
          broke: reject,
        });
        run.start(entry, values, encoder ?? unreachable('Every start has an encoder.'));
      });
    },
  };
}

/** The std's natives and the host's, which must implement every extern `tables` declares. */
function nativesOf(tables: LiveProgramTables, host: HostExterns): Natives {
  const natives = withHost(stdNatives, host);
  requireNatives(tables.functions, natives);
  return natives;
}

function endedOf(tables: LiveProgramTables, end: RunEnd, logs: readonly LogRecord[]): LiveEnded {
  if (end.kind === 'panicked') {
    return { ...end, logs };
  }
  return {
    kind: 'finished',
    outcome: outcomeJson(end, tables),
    text: outcomeText(end, tables),
    logs,
  };
}
