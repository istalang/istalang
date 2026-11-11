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
 *   implements take and give JSON (../boundary/host-natives.ts), it starts a function by its key
 *   with JSON arguments and reads the outcome as JSON (`outcome`) or its text (`outcomeText`), and
 *   it fills a future it named with JSON. JSON that doesn't fit what it was given for refuses the
 *   host's call, and nothing commits.
 */

import { recordExternSignatures } from '../boundary/extern-signatures.ts';
import type { Advanced, Inspection } from '../instance-state.ts';
import { Refusal } from '../refusal.ts';
import { inspection } from '../scheduler/inspect.ts';
import { Resident } from '../scheduler/resident.ts';
import {
  type Advance,
  type AdvanceFirst,
  advance,
  type SchedulerSeams,
  stateOf,
  terminate,
} from '../scheduler/wake.ts';
import type { PanickedSnapshot, Snapshot } from '../snapshot/snapshot.ts';
import type { InstanceObserver } from './contexts.ts';
import { InstanceCalls } from './instance-calls.ts';
import {
  type BoundProgram,
  type DeployedProgram,
  jsonIn,
  programBinder,
  type RuntimeSeams,
} from './programs.ts';
import { storedInstance } from './stored-instances.ts';

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
   * Ends a panicked instance as terminated (§3.12), disposing everything it holds (§7) from its
   * last commit; a Refusal for one that hasn't panicked.
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
  const { bind, residentOf } = residents(seams, held, calls);
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
        try {
          const resident = residentOf(instance);
          const arrival = arrivalAt(resident, token, json);
          return arrival === undefined
            ? unadvanced(resident.committed)
            : held.advance(resident, arrival);
        } finally {
          held.touched(instance);
        }
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
        return held.terminated(instance, terminate(scheduling, resident));
      }),
  };
}

/**
 * How a runtime binds Definition texts and finds its instances: held, or read from the store,
 * with the program its snapshot names bound (a Refusal for an instance the store lacks).
 */
function residents(seams: RuntimeSeams, held: Held, calls: InstanceCalls) {
  const bind = programBinder({
    ...seams,
    advance: held.advance,
    observe: held.observe,
    calls,
    residentOf: (instance) =>
      held.of(instance) === undefined && seams.store.readSnapshot(instance) === undefined
        ? undefined
        : residentOf(instance),
  });
  const residentOf = (instance: string) =>
    held.of(instance) ?? storedInstance(seams.store, (text) => bind(text).program, instance);
  return { bind, residentOf };
}

/** The instances a runtime holds (`heldInstances`). */
type Held = ReturnType<typeof heldInstances>;

/**
 * The instances a runtime holds, those whose last commit has them active (§5): whatever advancing
 * one did, it is held once it committed active, and let go of otherwise, from when on the store has
 * it, or never had it when its first commit failed. Every advance, and every termination, is shown
 * to whoever observes the runtime's instances, as the contexts of a live run do (contexts.ts), so
 * one a host's call made, a fill's or a retry's, reaches them too.
 */
function heldInstances(seams: SchedulerSeams) {
  const held = new Map<string, Resident<BoundProgram>>();
  const observers = new Set<InstanceObserver>();
  const shown = (instance: string, advanced: Advance): Advance => {
    for (const observer of observers) {
      observer(instance, advanced);
    }
    return advanced;
  };
  return {
    of: (instance: string): Resident<BoundProgram> | undefined => held.get(instance),
    advance: (resident: Resident<BoundProgram>, first?: AdvanceFirst): Advance => {
      let advanced: Advance;
      try {
        advanced = advance(seams, resident, first);
      } finally {
        const { instance, status } = resident.committed;
        if (status.kind === 'active') {
          held.set(instance, resident);
        } else {
          held.delete(instance);
        }
      }
      return shown(resident.committed.instance, advanced);
    },
    terminated: (instance: string, advanced: Advanced): Advanced =>
      shown(instance, { ...advanced, answered: [] }),
    /** Shows that a host's call on `instance` ended, which may have changed what can wake it. */
    touched: (instance: string): void => {
      for (const observer of observers) {
        observer(instance, undefined);
      }
    },
    observe: (observer: InstanceObserver): (() => void) => {
      observers.add(observer);
      return () => {
        observers.delete(observer);
      };
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
