/**
 * The runtime as a host uses it (§9): give it the seams, deploy a Definition, start instances of
 * it and wake them when their timers are due.
 *
 * - A Definition arrives as its persisted text, the form the store keeps. Deploying reads and
 *   validates all of it, binds every extern to its native and stores it by hash, so a Definition
 *   that couldn't run is refused before anything runs. A runtime writes each Definition once, after
 *   its externs are recorded, so deploying it again writes nothing.
 * - Every call that runs an instance's code gives a promise, so a host awaits it whatever the
 *   instance waits on; one the runtime refuses rejects with the Refusal. Calls on one instance run
 *   one after another (instance-calls.ts).
 * - Starting live code (proposal 8) runs it outside any instance, as a live run
 *   (../scheduler/live-run.ts): in memory, never written to the store, its promise settling at its
 *   end with how it ended. It takes no instance's options, since it never commits, and holds no
 *   instance's name: a host's other calls never wait for it, and none can reach it.
 * - An instance stays in memory while it is active (../scheduler/resident.ts), each commit also
 *   written to the store; the options it starts with (`crashEveryAwait`, §10) hold for its whole
 *   life. Starting or waking one advances it as far as it goes without waiting, committing every
 *   segment (../scheduler/wake.ts), and says where it stands: waiting until its next timer,
 *   finished with its outcome, or panicked with a message and a trace (§3.12), and which instances
 *   it spawned (§9), which the host wakes like any other. The host decides when to wake each again
 *   (drive.ts runs that loop); the runtime holds no timers of its own.
 * - Inspecting an instance reads its last commit only: where it stands, and where each of its
 *   executions waits (§9, §10).
 * - An instance the runtime doesn't hold, one that has ended or panicked, or any after a restart,
 *   is read from the store with the Definition its snapshot names, so a fresh runtime on the same
 *   store continues where an earlier one committed (§5). While a runtime runs, it is its store's
 *   only driver.
 * - Values cross as JSON (§9), so a host never reads the runtime's value shapes: the externs it
 *   implements take and give JSON (../boundary/host-natives.ts), it starts a function by its key with
 *   JSON arguments and reads the outcome as JSON (`outcome`) or its text (`outcomeText`), and it
 *   fills a future it named with JSON.
 *   JSON that doesn't fit what it was given for refuses the host's call, and nothing commits.
 */

import { type Definition, definitionFormat } from '../../definition/definition.ts';
import type { FunctionId } from '../../definition/operands.ts';
import { JsonError, jsonOfPlain, jsonTypeOf } from '../../definition/values/json-values.ts';
import type { Value } from '../../definition/values/values.ts';
import { memo } from '../../foundation/structures/memo.ts';
import { recordExternSignatures } from '../boundary/extern-signatures.ts';
import { type HostExterns, hostNatives } from '../boundary/host-natives.ts';
import { outcomeJson, outcomeText } from '../boundary/outbound.ts';
import type { Clock } from '../clock.ts';
import type { Advanced, Finished, Inspection, StartOptions } from '../instance-state.ts';
import type { Natives } from '../natives.ts';
import { Refusal } from '../refusal.ts';
import { inspection } from '../scheduler/inspect.ts';
import { spawnedSeparator } from '../scheduler/instance/instance-names.ts';
import { runLive } from '../scheduler/live-run.ts';
import { type LoadedDefinition, loadDefinition } from '../scheduler/loaded-definition.ts';
import { Resident } from '../scheduler/resident.ts';
import {
  type AdvanceFirst,
  advance,
  type SchedulerSeams,
  stateOf,
  terminate,
  unstarted,
} from '../scheduler/wake.ts';
import { seedTextOf } from '../snapshot/random.ts';
import type { PanickedSnapshot, Snapshot } from '../snapshot/snapshot.ts';
import type { InstanceStore } from '../store.ts';
import { InstanceCalls } from './instance-calls.ts';
import { storedInstance } from './stored-instances.ts';

export interface RuntimeSeams {
  readonly natives: Natives;
  readonly store: InstanceStore;
  /** The host's time: when each segment starts (§5), and what a live run waits on for its timers. */
  readonly clock: Clock;
  /**
   * A new secret seed, `seedBytes` random bytes (../snapshot/random.ts), for each instance a host
   * starts: the source of its random values (§3.8 `random`). An instance it spawns is seeded from
   * it in turn. A seed of another length refuses the start.
   */
  readonly seed: () => Uint8Array;
  /**
   * The externs the host implements, against JSON, by key (§9); a Refusal for a key `natives`
   * has, such as `time.now()`, which would replace the runtime's own.
   */
  readonly host?: HostExterns;
}

/** What a host starts: `main`, or the function it names by key, with its arguments as JSON (§9). */
export interface StartRequest extends StartOptions {
  readonly function?: string;
  readonly arguments?: readonly unknown[];
}

export interface DeployedProgram {
  readonly hash: string;
  /** The keys of the functions a host may start (§9). */
  readonly starts: readonly string[];
  /**
   * A finished instance's outcome as JSON a host works with; a Refusal when no codec writes its
   * type, so it has none (§9).
   */
  readonly outcome: (finished: Finished) => unknown;
  /** The same outcome as its JSON text (§9). */
  readonly outcomeText: (finished: Finished) => string;
  /**
   * Starts what `request` names as a new instance named `instance`, or live code as a live run by
   * that name, which settles at its end: a Refusal if the store already has an instance by the
   * name, if no function has the key, or if the arguments don't fit it.
   */
  readonly start: (instance: string, request?: StartRequest) => Promise<Advanced>;
}

export interface Runtime {
  /**
   * Reads a Definition's persisted text, binds its externs and stores it; throws a FormatError for
   * an invalid text, and a Refusal naming the externs no native implements.
   */
  readonly deploy: (text: string) => DeployedProgram;
  /**
   * Advances a stored instance: resolves its due timers and runs what is ready. A Refusal when the
   * store lacks the instance or its Definition, or when its snapshot doesn't fit the Definition; a
   * FormatError when a stored text has an unknown format or version.
   */
  readonly wake: (instance: string) => Promise<Advanced>;
  /** The program a stored instance runs; the same Refusals and FormatErrors as `wake`. */
  readonly programOf: (instance: string) => DeployedProgram;
  /** Where a stored instance stands and waits, read from its last commit; as `wake` refuses. */
  readonly inspect: (instance: string) => Inspection;
  /**
   * Fills the future the host named `token` with `json` and advances the instance (§9); a Refusal,
   * with nothing committed, when no such future waits or the JSON doesn't fit it.
   */
  readonly fill: (instance: string, token: string, json: unknown) => Promise<Advanced>;
  /**
   * Runs a panicked instance again from its last commit, the failed segment at the time it first
   * started (§3.12, §5); a Refusal for an instance that hasn't panicked.
   */
  readonly retry: (instance: string) => Promise<Advanced>;
  /**
   * Ends a panicked instance as terminated (§3.12), disposing everything it holds (§7) from its last
   * commit; a Refusal for one that hasn't panicked.
   */
  readonly terminate: (instance: string) => Promise<Advanced>;
}

export function createRuntime(seams: RuntimeSeams): Runtime {
  const shadowed = Object.keys(seams.host ?? {}).filter((key) => Object.hasOwn(seams.natives, key));
  if (shadowed.length > 0) {
    throw new Refusal(
      'reservedName',
      `The runtime implements ${shadowed.join(', ')} itself, so a host can't.`,
    );
  }
  const scheduling: SchedulerSeams = { store: seams.store, now: seams.clock.now };
  const held = heldInstances(scheduling);
  const calls = new InstanceCalls();
  const bind = programBinder({ ...seams, advance: held.advance, calls });
  const residentOf = (instance: string) =>
    held.of(instance) ?? storedInstance(seams.store, (text) => bind(text).program, instance);
  const written = new Set<string>();
  return {
    deploy: (text) => {
      const { program, canonical } = bind(text);
      recordExternSignatures(seams.store, program.definition);
      if (!written.has(program.hash)) {
        seams.store.writeDefinition(program.hash, canonical);
        written.add(program.hash);
      }
      return program;
    },
    wake: (instance) =>
      calls.run(instance, () => {
        const resident = residentOf(instance);
        const { kind } = resident.committed.status;
        return kind === 'active' || kind === 'unstarted'
          ? held.advance(resident)
          : unadvanced(resident.committed);
      }),
    programOf: (instance) => residentOf(instance).loaded,
    inspect: (instance) => {
      const { committed, loaded } = residentOf(instance);
      return inspection(loaded.definition, committed);
    },
    fill: (instance, token, json) =>
      calls.run(instance, () => {
        const resident = residentOf(instance);
        const arrival = arrivalAt(resident, token, json);
        return arrival === undefined
          ? unadvanced(resident.committed)
          : held.advance(resident, arrival);
      }),
    retry: (instance) =>
      calls.run(instance, () => {
        const { resident, first } = retried(residentOf(instance));
        return held.advance(resident, first);
      }),
    terminate: (instance) =>
      calls.run(instance, () => {
        const resident = residentOf(instance);
        panicked(resident.committed);
        return terminate(scheduling, resident);
      }),
  };
}

/**
 * The instances a runtime holds, those whose last commit has them active (§5): whatever advancing
 * one did, it is held once it committed active, and let go of otherwise, from when on the store has
 * it, or never had it when its first commit failed.
 */
function heldInstances(seams: SchedulerSeams) {
  const held = new Map<string, Resident<BoundProgram>>();
  return {
    of: (instance: string): Resident<BoundProgram> | undefined => held.get(instance),
    advance: (resident: Resident<BoundProgram>, first?: AdvanceFirst): Advanced => {
      try {
        return advance(seams, resident, first);
      } finally {
        const { instance, status } = resident.committed;
        if (status.kind === 'active') {
          held.set(instance, resident);
        } else {
          held.delete(instance);
        }
      }
    },
  };
}

/**
 * What filling the future `resident`'s host named `token` with `json` starts its next advance
 * with; undefined once it no longer waits. A Refusal when it panicked, or the JSON doesn't fit.
 */
function arrivalAt(
  resident: Resident<BoundProgram>,
  token: string,
  json: unknown,
): AdvanceFirst | undefined {
  const { status, instance } = resident.committed;
  if (status.kind === 'panicked') {
    throw new Refusal(
      'panicked',
      `Instance '${instance}' has panicked; retry it before filling its futures.`,
    );
  }
  const arrival = { token, value: jsonIn(resident.loaded.definition, json) };
  return status.kind === 'active' ? { kind: 'arrival', arrival } : undefined;
}

/**
 * `resident`, which panicked, made ready to run its failed segment again from its last commit, at
 * the time that segment first started (§3.12, §5); a Refusal when it hasn't panicked.
 */
function retried(resident: Resident<BoundProgram>): {
  readonly resident: Resident<BoundProgram>;
  readonly first: AdvanceFirst;
} {
  const { committed, loaded } = resident;
  const { replay, segmentStartedAt: startedAt } = panicked(committed).status;
  const status: Snapshot['status'] =
    replay?.kind === 'call' ? { kind: 'unstarted', call: replay.call } : { kind: 'active' };
  const step =
    replay !== undefined && replay.kind !== 'call' ? replay : ({ kind: 'none' } as const);
  return {
    resident: new Resident(loaded, { ...committed, status }),
    first: { ...step, startedAt },
  };
}

/** What a host call that runs nothing says of an instance: where its last commit has it. */
function unadvanced(committed: Snapshot): Advanced {
  return { state: stateOf(committed), spawned: [], logs: [] };
}

/** `snapshot`, an instance that panicked; a Refusal for any other (§3.12). */
function panicked(snapshot: Snapshot): PanickedSnapshot {
  const { status } = snapshot;
  if (status.kind !== 'panicked') {
    throw new Refusal('notPanicked', `Instance '${snapshot.instance}' hasn't panicked.`);
  }
  return { ...snapshot, status };
}

/** A deployed program as the runtime holds it: bound to its natives, the program it loads. */
interface BoundProgram extends DeployedProgram, LoadedDefinition {}

/** A Definition text bound to its program, with the canonical text the store keeps. */
interface Binding {
  readonly program: BoundProgram;
  readonly canonical: string;
}

/**
 * What binding a program needs: its natives, its host's, seeds, the clock its live runs wait on,
 * how to advance an instance, and the host's calls on each instance, one after another.
 */
interface BindingSeams extends Pick<RuntimeSeams, 'natives' | 'host' | 'seed' | 'store' | 'clock'> {
  readonly advance: (resident: Resident<BoundProgram>) => Advanced;
  readonly calls: InstanceCalls;
}

/**
 * Reads and binds Definition texts: each text is read, validated and written back once, and each
 * hash bound once, since every operation on a stored instance binds the text its snapshot names.
 * The canonical text finds its binding too, as the store gives that text back. It writes nothing.
 */
function programBinder(seams: BindingSeams) {
  const byHash = new Map<string, Binding>();
  const byText = new Map<string, Binding>();
  return (text: string): Binding =>
    memo(byText, text, () => {
      const { value: definition, hash, text: canonical } = definitionFormat.readCanonical(text);
      const binding = memo(byHash, hash, () => ({
        program: boundProgram(seams, definition, hash),
        canonical,
      }));
      byText.set(binding.canonical, binding);
      return binding;
    });
}

/** `definition`, bound to its natives and able to start its instances. */
function boundProgram(seams: BindingSeams, definition: Definition, hash: string): BoundProgram {
  const loaded = loadDefinition(definition, hash, {
    ...seams.natives,
    ...hostNatives(seams.host ?? {}),
  });
  const program: BoundProgram = {
    ...loaded,
    starts: definition.starts.map(({ key }) => key),
    outcome: (finished) => outcomeJson(finished, definition),
    outcomeText: (finished) => outcomeText(finished, definition),
    start: (instance, { function: key, arguments: given = [], ...options } = {}) => {
      const begun = (): Snapshot => {
        if (instance.includes(spawnedSeparator)) {
          throw new Refusal(
            'reservedName',
            `'${instance}' names a spawned instance: a host's names have no '${spawnedSeparator}'.`,
          );
        }
        if (seams.store.readSnapshot(instance) !== undefined) {
          throw new Refusal('instanceExists', `The store already holds an instance '${instance}'.`);
        }
        const { entry, encoder } = startOf(definition, key, given.length);
        const values = given.map((json) => jsonIn(definition, json));
        const call = { function: entry, captures: [], arguments: values };
        const beginning = { ...options, seed: seedTextOf(seams.seed()), encoder };
        return unstarted(program, instance, call, beginning);
      };
      return startsLive(definition, key)
        ? (async () => await runLive(seams.clock, program, begun()))()
        : seams.calls.run(instance, () => seams.advance(new Resident(program, begun())));
    },
  };
  return program;
}

/**
 * The entry `key` names, `main`'s without one, with the encoder its listing in `starts` gives its
 * outcome; a Refusal unless it takes `count` arguments.
 */
function startOf(definition: Definition, key: string | undefined, count: number): StartCall {
  const { entry, encoder } = listedStart(definition, key);
  const takes = entry === undefined ? undefined : definition.functions[entry]?.parameters.length;
  if (entry === undefined || takes !== count) {
    const what = key === undefined ? "'main'" : `'${key}'`;
    throw new Refusal(
      'notStartable',
      takes === undefined
        ? `The program has no ${what} a host can start.`
        : `${what} takes ${takes} arguments, not ${count}.`,
    );
  }
  return { entry, encoder };
}

/** The entry `key` names, `main`'s without one, and its encoder; undefined for what none has. */
function listedStart(
  definition: Definition,
  key: string | undefined,
): { readonly entry: FunctionId | undefined; readonly encoder: FunctionId | undefined } {
  const listed = definition.starts.find((start) =>
    key === undefined ? start.function === definition.main : start.key === key,
  );
  return {
    entry: key === undefined ? definition.main : listed?.function,
    encoder: listed?.encoder,
  };
}

/**
 * Whether what `key` names starts as a live run (proposal 8): its entry is live code, which runs
 * outside any instance. Anything else starts an instance, a plain entry included, as it always has.
 */
function startsLive(definition: Definition, key: string | undefined): boolean {
  const { entry } = listedStart(definition, key);
  const code = entry === undefined ? undefined : definition.functions[entry];
  return code?.kind === 'code' && code.mode === 'live';
}

/** What a host starts: the entry, and the encoder of its outcome when it has one. */
interface StartCall {
  readonly entry: FunctionId;
  readonly encoder: FunctionId | undefined;
}

/** JSON a host gave, as the `Json` value it holds; a Refusal for what JSON can't hold. */
function jsonIn(definition: Definition, json: unknown): Value {
  try {
    return jsonOfPlain(json, jsonTypeOf(definition.types));
  } catch (error) {
    if (error instanceof JsonError) {
      // biome-ignore lint/style/useErrorCause: a Refusal takes its reason first, so the cause is third.
      throw new Refusal('unfitJson', error.message, { cause: error });
    }
    throw error;
  }
}
