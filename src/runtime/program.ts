/**
 * Starting a compiled program's live code, as a host does (§9; ir-first design, decision 10): one
 * binding of natives, the host's externs, a clock and a seed serves `ista run`, `ista test`, `ista
 * build`'s output and an embedding host alike.
 *
 * - A program is compiled once per Definition (codegen), and each start is a run of its own; a
 *   built program brings its code, compiled when it was built (live/program.ts).
 * - A start runs the start entry its key names, `main`'s with none (boundary/starts.ts), with the
 *   host's JSON arguments, and drives the run until the outcome settles: what is ready first, then
 *   what arrives from a host, then the clock to the next timer, while anything is left to wait for.
 *   The outcome is the JSON its start encoded; a panic ends the run with its message and trace.
 */

import { type EmittedProgram, emitProgram } from '../codegen/emit.ts';
import type { Definition, KeyedDefinition } from '../definition/definition.ts';
import { jsonText, jsonTypeOf, plainOfJson } from '../definition/values/json-values.ts';
import type { Value } from '../definition/values/values.ts';
import { memo } from '../foundation/structures/memo.ts';
import { type HostExterns, withHost } from './boundary/host-natives.ts';
import type { Clock } from './clock.ts';
import { DurableWorld } from './host/durable-world.ts';
import { deployed } from './host/programs.ts';
import type { LogRecord } from './instance-state.ts';
import type { Natives } from './natives.ts';
import { memoryStore } from './store.ts';

/** What every start of a program is bound to: the natives, the host's externs, a clock, a seed. */
export interface HostBinding {
  readonly natives: Natives;
  readonly externs?: HostExterns;
  readonly clock: Clock;
  readonly seed: Uint8Array;
}

/** How a live start ended: its outcome as JSON, its panic, or waiting on nothing left to come. */
export type LiveEnd =
  | { readonly kind: 'finished'; readonly outcome: unknown; readonly text: string }
  | { readonly kind: 'panicked'; readonly message: string; readonly trace: string }
  | { readonly kind: 'unsettled' };

export interface LiveRun {
  readonly end: LiveEnd;
  readonly logs: readonly LogRecord[];
}

/** What a start names: its key, `main`'s without one, its arguments as JSON, the run's name. */
export interface Start {
  readonly key?: string;
  readonly arguments?: readonly unknown[];
  readonly instance?: string;
  /** Whether the contexts it makes crash at every await (§10). */
  readonly crashEveryAwait?: boolean;
}

/** The code a start runs: compiled from its Definition once, unless a built program brings it. */
export interface LiveCode {
  readonly code?: EmittedProgram;
  /**
   * The code each run read back from a snapshot runs: `code`, but in a test of two builds of one
   * Definition (docs/work/ir-first/contracts.md), which gives another.
   */
  readonly readBack?: () => EmittedProgram;
}

const emitted = new WeakMap<Definition, EmittedProgram>();

/**
 * Starts `keyed`'s live code as `start` says, bound by `binding`, running `live`'s code; how it
 * ended. The ista instances it reaches are the world's, in a store of their own that ends with
 * the start, committed at every await as any host's are (§5).
 */
export async function startLive(
  { definition, hash }: KeyedDefinition,
  binding: HostBinding,
  start: Start = {},
  live: LiveCode = {},
): Promise<LiveRun> {
  const logs: LogRecord[] = [];
  const program = {
    definition,
    hash,
    emitted: live.code ?? memo(emitted, definition, () => emitProgram(definition)),
  };
  const { readBack } = live;
  const world = new DurableWorld(
    {
      natives: withHost(binding.natives, binding.externs ?? {}),
      store: memoryStore(),
      clock: binding.clock,
      seed: () => binding.seed,
      reports: { logs: (records) => logs.push(...records), panicked: () => undefined },
    },
    () => (readBack === undefined ? program : { ...program, emitted: readBack() }),
  );
  const { state, logs: own } = await deployed(world, program).start(start.instance ?? 'run', {
    ...(start.key === undefined ? {} : { function: start.key }),
    ...(start.arguments === undefined ? {} : { arguments: start.arguments }),
    ...(start.crashEveryAwait === undefined ? {} : { crashEveryAwait: start.crashEveryAwait }),
  });
  logs.push(...own);
  switch (state.kind) {
    case 'finished':
      return { end: finished(definition, state.encoded ?? state.outcome), logs };
    case 'panicked':
    case 'terminated':
      return { end: { kind: 'panicked', message: state.message, trace: state.trace }, logs };
    default:
      return { end: { kind: 'unsettled' }, logs };
  }
}

function finished(definition: Definition, outcome: Value): LiveEnd {
  const shape = jsonTypeOf(definition.types);
  return { kind: 'finished', outcome: plainOfJson(outcome, shape), text: jsonText(outcome, shape) };
}
