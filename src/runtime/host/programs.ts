/**
 * Deployed programs (§9): a Definition emitted and stored once per hash, and starting what a host
 * may start of it by key, with its arguments as JSON.
 *
 * - A start runs on a turn of its own, as every host call does (host-turns.ts).
 * - A host starts live or simple code only, as a live run: in memory, never written to the store,
 *   its promise settling with how it ended, at once when its root call returns (§10). Ista code
 *   runs in the contexts live code calls (§9), each an instance of the world, which a start's
 *   options (`crashEveryAwait`, §10) hold for.
 * - What crosses is JSON: arguments are decoded by the start entry, and the outcome encoded by
 *   the start's encoding entry, the moment the root call's outcome settles; an outcome JSON can't
 *   hold refuses the start, once the run finished.
 * - A host's misuse of a resolver panics the run, even in the step its root returned in
 *   (runtime/natives.ts `HostFilling`).
 */

import { emitProgram } from '../../codegen/emit.ts';
import type { Definition, KeyedDefinition } from '../../definition/definition.ts';
import { jsonText, jsonTypeOf } from '../../definition/values/json-values.ts';
import type { Value } from '../../definition/values/values.ts';
import { checkJsonOut, jsonIn, startOf } from '../boundary/starts.ts';
import type { Advanced, Finished, LogRecord, StartOptions } from '../instance-state.ts';
import { Refusal } from '../refusal.ts';
import { Future } from '../run/objects/future.ts';
import type { DurableWorld } from './durable-world.ts';
import { hostTurn } from './host-turns.ts';
import type { WorldProgram } from './resident.ts';

/** What a host hears of the instances it doesn't advance itself: their log records and panics. */
export interface HostReports {
  readonly logs: (records: readonly LogRecord[]) => void;
  readonly panicked: (
    instance: string,
    panic: { readonly message: string; readonly trace: string },
  ) => void;
}

/** What a host asks a start for: which function, with what JSON arguments, and how it runs. */
interface StartRequest extends StartOptions {
  readonly function?: string;
  readonly arguments?: readonly unknown[];
}

export interface DeployedProgram {
  readonly hash: string;
  readonly definition: Definition;
  /** Starts the function `request` names, `main` by default, as the live run `name`. */
  readonly start: (name: string, request?: StartRequest) => Promise<Advanced>;
  /** A finished instance's outcome as JSON text. */
  readonly outcomeText: (finished: Finished) => string;
}

/** The program a world runs of `keyed`: its code emitted. */
export function worldProgram({ definition, hash }: KeyedDefinition): WorldProgram {
  return { definition, hash, emitted: emitProgram(definition) };
}

/** `program`, deployed to `world`: what a host starts and reads of it. */
export function deployed(world: DurableWorld, program: WorldProgram): DeployedProgram {
  const { definition, hash } = program;
  return {
    hash,
    definition,
    start: (name, request = {}) => hostTurn(() => started(world, program, name, request)),
    outcomeText: (finished) =>
      finished.encoded === undefined
        ? plainText(finished.outcome)
        : jsonText(finished.encoded, jsonTypeOf(definition.types)),
  };
}

/** Runs a start of `program` as the live run `name` until its root call's outcome settles. */
async function started(
  world: DurableWorld,
  program: WorldProgram,
  name: string,
  request: StartRequest,
): Promise<Advanced> {
  const { definition } = program;
  const passed = request.arguments ?? [];
  const start = startOf(definition, request.function, passed.length);
  const logs: LogRecord[] = [];
  const run = world.liveRun(program, name, (record) => logs.push(record), request);
  try {
    const given = run.call(
      start.function,
      passed.map((each) => jsonIn(definition, each)),
    );
    const outcome = await settled(world, given);
    if (outcome === undefined) {
      return { state: { kind: 'waiting', until: undefined, watching: [] }, spawned: [], logs };
    }
    // A host's misuse in the step its root returned in panics it all the same.
    run.arrivals.raiseMisuse();
    const encoded = run.call(start.encode, [outcome]) as Value;
    run.finish([given as Value]);
    world.endLive(run);
    // The instances it reached go on as far as they can without waiting, as a host runs any other.
    world.drain();
    checkJsonOut(definition, encoded);
    return { state: { kind: 'finished', outcome, encoded }, spawned: [], logs };
  } catch (error) {
    const { message, trace } = run.traces.panicOf(error);
    return { state: { kind: 'panicked', message, trace }, spawned: [], logs };
  } finally {
    world.endLive(run);
  }
}

/** What `given` gives: at once from simple code, else once its future settles, if it does. */
async function settled(world: DurableWorld, given: unknown): Promise<Value | undefined> {
  if (!(given instanceof Future)) {
    return given as Value;
  }
  const done = () => given.settled;
  const { clock } = world.seams;
  for (;;) {
    world.drain(done);
    if (given.settled) {
      return given.value;
    }
    const timer = world.nextTimer();
    if (world.awaitsHost) {
      // biome-ignore lint/performance/noAwaitInLoops: each turn waits on what the last one left.
      await (timer === undefined
        ? world.arrival()
        : Promise.race([world.arrival(), clock.until(timer)]));
    } else if (timer === undefined) {
      return undefined;
    } else {
      await clock.until(timer);
    }
    world.fireDue(clock.now(), done);
  }
}

/**
 * An outcome no encoding wrote, a spawned instance's (§9), as JSON text: a primitive as JSON writes
 * it, an int exactly; anything else has no text without its type's codec.
 */
function plainText(outcome: Value): string {
  if (typeof outcome === 'bigint') {
    return outcome.toString();
  }
  if (
    outcome === null ||
    typeof outcome === 'string' ||
    typeof outcome === 'boolean' ||
    typeof outcome === 'number'
  ) {
    return JSON.stringify(outcome);
  }
  throw new Refusal('noJsonForm', "The outcome has no JSON form without its type's codec.");
}
