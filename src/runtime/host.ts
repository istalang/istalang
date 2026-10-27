/**
 * The runtime as a host uses it (§9): give it the seams, deploy a Definition, start instances of
 * it and wake them when their timers are due.
 *
 * - A Definition arrives as its persisted text, the form the store keeps. Deploying reads and
 *   validates all of it, binds every extern to its native and stores it by hash, so a Definition
 *   that couldn't run is refused before anything runs. A Definition this runtime already bound is
 *   in the store already, so deploying it again writes nothing.
 * - An instance lives in the store between calls; the options it starts with (`crashEveryAwait`,
 *   §10) hold for its whole life. Starting or waking one advances it as far as it goes without
 *   waiting, committing every segment (scheduler/wake.ts), and says where it stands: waiting
 *   until its next timer, finished with its outcome, or panicked with a message and a trace
 *   (§3.12), and which instances it spawned (§9), which the host wakes like any other. The host
 *   decides when to wake each again (settle.ts drives that loop for a host that only waits); the
 *   runtime holds no timers of its own.
 * - Inspecting an instance reads its last commit only: where it stands, and where each of its
 *   executions waits (§9, §10).
 * - Waking reads the instance's snapshot and the Definition it names from the store, so a fresh
 *   runtime on the same store continues where an earlier one committed (§5).
 * - Values cross as JSON (§9), so a host never reads the runtime's value shapes: the externs it
 *   implements take and give JSON (boundary/host-natives.ts), it starts a function by its key with
 *   JSON arguments and reads the outcome as JSON (`outcome`) or its text (`outcomeText`), and it
 *   fills a future it named with JSON.
 *   JSON that doesn't fit what it was given for refuses the host's call, and nothing commits.
 */

import { type Definition, definitionFormat } from '../definition/definition.ts';
import { JsonError, jsonOfPlain, jsonTypeOf } from '../definition/json-values.ts';
import type { FunctionId } from '../definition/operands.ts';
import type { Value } from '../definition/values.ts';
import { memo } from '../structures/memo.ts';
import { recordExternSignatures } from './boundary/extern-signatures.ts';
import { type HostExterns, hostNatives } from './boundary/host-natives.ts';
import { outcomeJson, outcomeText } from './boundary/outbound.ts';
import type { Advanced } from './instance-state.ts';
import type { Natives } from './natives.ts';
import { Refusal } from './refusal.ts';
import { type Inspection, inspection } from './scheduler/inspect.ts';
import type { StartOptions } from './scheduler/instance.ts';
import { spawnedSeparator } from './scheduler/instance-names.ts';
import { type LoadedDefinition, loadDefinition } from './scheduler/loaded-definition.ts';
import {
  type AdvanceFirst,
  advance,
  type SchedulerSeams,
  stateOf,
  terminate,
  unstarted,
} from './scheduler/wake.ts';
import { checkSnapshot } from './snapshot/check.ts';
import { type Snapshot, snapshotFormat } from './snapshot/snapshot.ts';
import type { InstanceStore } from './store.ts';

export interface RuntimeSeams {
  readonly natives: Natives;
  readonly store: InstanceStore;
  /** Milliseconds since the Unix epoch: when each segment starts (§5). */
  readonly now: () => bigint;
  /**
   * A new secret seed, 64 lowercase hex digits, for each instance a host starts: the source of its
   * random values (§3.8 `random`). An instance it spawns is seeded from it in turn.
   */
  readonly seed: () => string;
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
  /** An outcome a start entry encoded, as JSON a host works with; a Refusal for any other. */
  readonly outcome: (value: Value) => unknown;
  /** The same outcome as its JSON text (§9). */
  readonly outcomeText: (value: Value) => string;
  /**
   * Starts what `request` names as a new instance named `instance`: a Refusal if the store already
   * has one, if no function has the key, or if the arguments don't fit it.
   */
  readonly start: (instance: string, request?: StartRequest) => Advanced;
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
  readonly wake: (instance: string) => Advanced;
  /** The program a stored instance runs; the same Refusals and FormatErrors as `wake`. */
  readonly programOf: (instance: string) => DeployedProgram;
  /** Where a stored instance stands and waits, read from its last commit; as `wake` refuses. */
  readonly inspect: (instance: string) => Inspection;
  /**
   * Fills the future the host named `token` with `json` and advances the instance (§9); a Refusal,
   * with nothing committed, when no such future waits or the JSON doesn't fit it.
   */
  readonly fill: (instance: string, token: string, json: unknown) => Advanced;
  /**
   * Runs a panicked instance again from its last commit, the failed segment at the time it first
   * started (§3.12, §5); a Refusal for an instance that hasn't panicked.
   */
  readonly retry: (instance: string) => Advanced;
  /**
   * Ends a panicked instance as terminated (§3.12), disposing everything it holds (§7) from its last
   * commit; a Refusal for one that hasn't panicked.
   */
  readonly terminate: (instance: string) => Advanced;
}

export function createRuntime(seams: RuntimeSeams): Runtime {
  const shadowed = Object.keys(seams.host ?? {}).filter((key) => Object.hasOwn(seams.natives, key));
  if (shadowed.length > 0) {
    throw new Refusal(
      'reservedName',
      `The runtime implements ${shadowed.join(', ')} itself, so a host can't.`,
    );
  }
  const bind = programBinder(seams);
  const stored = (instance: string) => storedInstance(seams.store, bind, instance);
  return {
    deploy: (text) => {
      const { program, isNew } = bind(text);
      recordExternSignatures(seams.store, program.definition);
      if (isNew) {
        seams.store.writeDefinition(program.hash, definitionFormat.write(program.definition).text);
      }
      return program;
    },
    wake: (instance) => {
      const { snapshot, program } = stored(instance);
      const { kind } = snapshot.status;
      return kind === 'active' || kind === 'unstarted'
        ? program.resume(snapshot)
        : { state: stateOf(snapshot), spawned: [], logs: [] };
    },
    programOf: (instance) => stored(instance).program,
    inspect: (instance) => {
      const { snapshot, program } = stored(instance);
      return inspection(program.definition, snapshot);
    },
    fill: (instance, token, json) => {
      const { snapshot, program } = stored(instance);
      const { kind } = snapshot.status;
      if (kind === 'panicked') {
        throw new Refusal(
          'panicked',
          `Instance '${instance}' has panicked; retry it before filling its futures.`,
        );
      }
      const arrival = { token, value: jsonIn(program.definition, json) };
      return kind === 'active'
        ? program.resume(snapshot, { arrival })
        : { state: stateOf(snapshot), spawned: [], logs: [] };
    },
    retry: (instance) => {
      const { snapshot, program } = stored(instance);
      const { replay, segmentStartedAt: startedAt } = panicked(snapshot).status;
      const status: Snapshot['status'] =
        replay?.kind === 'call' ? { kind: 'unstarted', call: replay.call } : { kind: 'active' };
      return program.resume(
        { ...snapshot, status },
        replay?.kind === 'arrival' ? { startedAt, arrival: replay.arrival } : { startedAt },
      );
    },
    terminate: (instance) => {
      const { snapshot, program } = stored(instance);
      return program.terminate(panicked(snapshot));
    },
  };
}

/** `snapshot`, an instance that panicked; a Refusal for any other (§3.12). */
function panicked(
  snapshot: Snapshot,
): Snapshot & { readonly status: Extract<Snapshot['status'], { kind: 'panicked' }> } {
  const { status } = snapshot;
  if (status.kind !== 'panicked') {
    throw new Refusal('notPanicked', `Instance '${snapshot.instance}' hasn't panicked.`);
  }
  return { ...snapshot, status };
}

/** A deployed program as the runtime holds it: bound, and able to resume its instances. */
interface BoundProgram extends DeployedProgram, LoadedDefinition {
  readonly resume: (snapshot: Snapshot, first?: AdvanceFirst) => Advanced;
  readonly terminate: (snapshot: Snapshot) => Advanced;
}

/** A Definition text bound to its program, and whether this was the first time. */
interface Binding {
  readonly program: BoundProgram;
  readonly isNew: boolean;
}

/** Reads and binds Definition texts, once per hash; it writes nothing. */
function programBinder(seams: SchedulerSeams & Pick<RuntimeSeams, 'natives' | 'host' | 'seed'>) {
  const bound = new Map<string, BoundProgram>();
  return (text: string): Binding => {
    const definition = definitionFormat.read(text);
    const { hash } = definitionFormat.write(definition);
    const isNew = !bound.has(hash);
    return { program: memo(bound, hash, () => boundProgram(seams, definition, hash)), isNew };
  };
}

/** `definition`, bound to its natives and able to start and resume its instances. */
function boundProgram(
  seams: SchedulerSeams & Pick<RuntimeSeams, 'natives' | 'host' | 'seed'>,
  definition: Definition,
  hash: string,
): BoundProgram {
  const loaded = loadDefinition(definition, hash, {
    ...seams.natives,
    ...hostNatives(seams.host ?? {}),
  });
  return {
    ...loaded,
    starts: definition.starts.map(({ key }) => key),
    outcome: (value) => outcomeJson(value, definition),
    outcomeText: (value) => outcomeText(value, definition),
    start: (instance, { function: key, arguments: given = [], ...options } = {}) => {
      if (instance.includes(spawnedSeparator)) {
        throw new Refusal(
          'reservedName',
          `'${instance}' names a spawned instance: a host's names have no '${spawnedSeparator}'.`,
        );
      }
      if (seams.store.readSnapshot(instance) !== undefined) {
        throw new Refusal('instanceExists', `The store already holds an instance '${instance}'.`);
      }
      const entry = startFunctionOf(definition, key, given.length);
      const values = given.map((json) => jsonIn(definition, json));
      const call = { function: entry, captures: [], arguments: values };
      const beginning = { ...options, seed: seams.seed() };
      return advance(seams, loaded, unstarted(loaded, instance, call, beginning));
    },
    resume: (snapshot, first) => advance(seams, loaded, snapshot, first),
    terminate: (snapshot) => terminate(seams, loaded, snapshot),
  };
}

/** The start entry `key` names, `main`'s without one; a Refusal unless it takes `count` arguments. */
function startFunctionOf(
  definition: Definition,
  key: string | undefined,
  count: number,
): FunctionId {
  const entry =
    key === undefined
      ? definition.main
      : definition.starts.find((start) => start.key === key)?.function;
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
  return entry;
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

/** A stored instance's snapshot and the program it runs, checked against each other. */
function storedInstance(
  store: InstanceStore,
  bind: (text: string) => Binding,
  instance: string,
): { readonly snapshot: Snapshot; readonly program: BoundProgram } {
  const text = store.readSnapshot(instance);
  if (text === undefined) {
    throw new Refusal('unknownInstance', `The store holds no instance '${instance}'.`);
  }
  const snapshot = snapshotFormat.read(text);
  const definition = store.readDefinition(snapshot.definition);
  if (definition === undefined) {
    throw new Refusal(
      'unknownDefinition',
      `The store holds no Definition ${snapshot.definition} for instance '${instance}'.`,
    );
  }
  const { program } = bind(definition);
  if (program.hash !== snapshot.definition) {
    throw new Refusal(
      'snapshotMismatch',
      `The store's Definition ${snapshot.definition} for instance '${instance}' hashes to ${program.hash}.`,
    );
  }
  checkSnapshot(program.definition, snapshot);
  return { snapshot, program };
}
