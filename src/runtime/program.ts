/**
 * Starting a compiled program's live code, as a host does (§9; ir-first design, decision 10): one
 * binding of natives, the host's externs, a clock and a seed serves `ista run`, `ista test`, `ista
 * build`'s output and an embedding host alike.
 *
 * - A program is compiled once per Definition (codegen), and each start is a run of its own.
 * - A start runs the start entry its key names, `main`'s with none (boundary/starts.ts), with the
 *   host's JSON arguments, and drives the run until the outcome settles: what is ready first, then
 *   what arrives from a host, then the clock to the next timer, while anything is left to wait for.
 *   The outcome is the JSON its start encoded; a panic ends the run with its message and trace.
 */

import { emitProgram, type EmittedProgram } from '../codegen/emit.ts';
import type { Definition } from '../definition/definition.ts';
import { jsonText, jsonTypeOf, plainOfJson } from '../definition/values/json-values.ts';
import type { Value } from '../definition/values/values.ts';
import { memo } from '../foundation/structures/memo.ts';
import { type HostExterns, withHost } from './boundary/host-natives.ts';
import { jsonIn, startOf } from './boundary/starts.ts';
import type { Clock } from './clock.ts';
import type { LogRecord } from './instance-state.ts';
import type { Natives } from './natives.ts';
import { Future } from './run/objects.ts';
import { Run } from './run/run.ts';

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
}

const emitted = new WeakMap<Definition, EmittedProgram>();

/** Starts `definition`'s live code as `start` says, bound by `binding`; how it ended. */
export async function startLive(
  definition: Definition,
  binding: HostBinding,
  start: Start = {},
): Promise<LiveRun> {
  const passed = start.arguments ?? [];
  const started = startOf(definition, start.key, passed.length);
  const logs: LogRecord[] = [];
  const run = new Run(
    definition,
    memo(emitted, definition, () => emitProgram(definition)),
    {
      natives: withHost(binding.natives, binding.externs ?? {}),
      clock: binding.clock,
      seed: binding.seed,
      instance: start.instance ?? 'run',
      log: (record) => logs.push(record),
    },
  );
  try {
    const given = run.call(
      started.function,
      passed.map((each) => jsonIn(definition, each)),
    );
    const outcome = await settled(run, binding.clock, given);
    if (outcome === undefined) {
      return { end: { kind: 'unsettled' }, logs };
    }
    const end = finished(definition, run.call(started.encode, [outcome]) as Value);
    run.finish([given as Value]);
    return { end, logs };
  } catch (error) {
    const { message, trace } = run.panicOf(error);
    return { end: { kind: 'panicked', message, trace }, logs };
  }
}

/** The outcome `given` gives: at once from simple code, else once its future settles, if it does. */
async function settled(run: Run, clock: Clock, given: unknown): Promise<Value | undefined> {
  if (!(given instanceof Future)) {
    return given as Value;
  }
  const done = () => given.settled;
  for (;;) {
    run.drain(done);
    run.takeArrivals(done);
    if (given.settled) {
      return given.value;
    }
    const timer = run.nextTimer();
    if (run.awaitsHost) {
      // biome-ignore lint/performance/noAwaitInLoops: each turn waits on what the last one left.
      await (timer === undefined ? run.arrival() : Promise.race([run.arrival(), clock.until(timer)]));
    } else if (timer === undefined) {
      return undefined;
    } else {
      await clock.until(timer);
    }
    run.fireDue(clock.now());
  }
}

function finished(definition: Definition, outcome: Value): LiveEnd {
  const shape = jsonTypeOf(definition.types);
  return { kind: 'finished', outcome: plainOfJson(outcome, shape), text: jsonText(outcome, shape) };
}
