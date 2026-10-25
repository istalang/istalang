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
 * - A deployed program's function table is exposed, so a test or the `testing` module can replace
 *   an entry (§10); it applies to every instance this runtime runs on that Definition.
 * - Values leave as JSON through `json` (§9), so a host never reads the runtime's value shapes.
 */

import { type Definition, definitionFormat } from '../definition/definition.ts';
import type { Value } from '../definition/values.ts';
import { memo } from '../structures/memo.ts';
import { outboundJson } from './boundary/outbound.ts';
import type { Advanced } from './instance-state.ts';
import { FunctionTable } from './interpreter/function-table.ts';
import type { Natives } from './natives.ts';
import { Refusal } from './refusal.ts';
import { type Inspection, inspection } from './scheduler/inspect.ts';
import type { LoadedDefinition, StartOptions } from './scheduler/instance.ts';
import { advance, type SchedulerSeams, stateOf, unstarted } from './scheduler/wake.ts';
import { checkSnapshot } from './snapshot/check.ts';
import { type Snapshot, snapshotFormat } from './snapshot/snapshot.ts';
import type { InstanceStore } from './store.ts';

export interface RuntimeSeams {
  readonly natives: Natives;
  readonly store: InstanceStore;
  /** Milliseconds since the Unix epoch: when each segment starts (§5). */
  readonly now: () => bigint;
}

export interface DeployedProgram {
  readonly hash: string;
  readonly functions: FunctionTable;
  /** A value of this program as the JSON a host receives (§9); a Refusal for one without a form yet. */
  readonly json: (value: Value) => string;
  /** Starts `main` as a new instance named `instance`; a Refusal if the store already has one. */
  readonly start: (instance: string, options?: StartOptions) => Advanced;
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
}

export function createRuntime(seams: RuntimeSeams): Runtime {
  const bind = programBinder(seams);
  const stored = (instance: string) => storedInstance(seams.store, bind, instance);
  return {
    deploy: (text) => {
      const { program, isNew } = bind(text);
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
        : { state: stateOf(snapshot), spawned: [] };
    },
    programOf: (instance) => stored(instance).program,
    inspect: (instance) => {
      const { snapshot, program } = stored(instance);
      return inspection(program.definition, snapshot);
    },
  };
}

/** A deployed program as the runtime holds it: bound, and able to resume its instances. */
interface BoundProgram extends DeployedProgram, LoadedDefinition {
  readonly resume: (snapshot: Snapshot) => Advanced;
}

/** A Definition text bound to its program, and whether this was the first time. */
interface Binding {
  readonly program: BoundProgram;
  readonly isNew: boolean;
}

/** Reads and binds Definition texts, once per hash; it writes nothing. */
function programBinder(seams: SchedulerSeams & Pick<RuntimeSeams, 'natives'>) {
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
  seams: SchedulerSeams & Pick<RuntimeSeams, 'natives'>,
  definition: Definition,
  hash: string,
): BoundProgram {
  const loaded: LoadedDefinition = {
    definition,
    hash,
    functions: new FunctionTable(definition, seams.natives),
  };
  return {
    ...loaded,
    json: (value) => outboundJson(value, definition),
    start: (instance, options = {}) => {
      if (seams.store.readSnapshot(instance) !== undefined) {
        throw new Refusal('instanceExists', `The store already holds an instance '${instance}'.`);
      }
      const { main } = definition;
      if (main === undefined) {
        throw new Error('Only a Definition with a main starts from main.');
      }
      const call = { function: main, captures: [], arguments: [] };
      return advance(seams, loaded, unstarted(loaded, instance, call, options));
    },
    resume: (snapshot) => advance(seams, loaded, snapshot),
  };
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
