/**
 * What a host asks of one instance (§9): wake it, retry or terminate it once it panicked, inspect
 * it, read its program. An instance the world doesn't hold is read from the store first.
 *
 * - Waking, retrying or terminating says where the instance stands after (`Advanced`): waiting,
 *   finished with its outcome, panicked or terminated, with the instances it spawned and the log
 *   records its committed segments wrote, which go to that call rather than the host's reports.
 * - A retry runs the failed segment again from the instance as it stood before it, at the time it
 *   started (§3.12), the call starting it included when it was the first.
 * - Inspecting reads its last commit only.
 */

import type { Advanced, Inspection, InstanceState, LogRecord } from '../instance-state.ts';
import { Refusal } from '../refusal.ts';
import type { PersistedStatus } from '../snapshot/format.ts';
import type { DurableWorld } from './durable-world.ts';
import { type DeployedProgram, deployed } from './programs.ts';
import type { Resident } from './resident.ts';
import { waitingAt } from './waiting.ts';

export interface InstanceCalls {
  readonly wake: (instance: string) => Promise<Advanced>;
  readonly retry: (instance: string) => Promise<Advanced>;
  readonly terminate: (instance: string) => Promise<Advanced>;
  readonly inspect: (instance: string) => Inspection;
  readonly programOf: (instance: string) => DeployedProgram;
}

/** The calls a host makes on the instances of `world`. */
export function instanceCalls(world: DurableWorld): InstanceCalls {
  const residentOf = (instance: string): Resident => {
    const resident = world.residents.get(instance) ?? world.load(instance);
    if (resident === undefined) {
      throw new Refusal('unknownInstance', `The store holds no instance '${instance}'.`);
    }
    return resident;
  };
  return {
    wake: (instance) => {
      const resident = residentOf(instance);
      return Promise.resolve(
        resident.ended
          ? { state: stateOf(resident), spawned: [], logs: [] }
          : advanced(world, resident, () => resident.wake(world.seams.clock.now())),
      );
    },
    retry: (instance) => {
      const resident = residentOf(instance);
      const status = panicked(resident);
      return Promise.resolve(advanced(world, resident, () => retried(world, resident, status)));
    },
    terminate: (instance) => {
      const resident = residentOf(instance);
      const { message, trace } = panicked(resident);
      return Promise.resolve(
        advanced(world, resident, () => world.terminate(resident, { message, trace })),
      );
    },
    inspect: (instance) => inspectionOf(residentOf(instance)),
    programOf: (instance) => deployed(world, residentOf(instance).program),
  };
}

type Panicked = Extract<PersistedStatus, { kind: 'panicked' }>;

function panicked(resident: Resident): Panicked {
  if (resident.status.kind !== 'panicked') {
    throw new Refusal('notPanicked', `'${resident.name}' hasn't panicked.`);
  }
  return resident.status;
}

/** Runs `resident`'s failed segment again, from where it stood before it (§3.12). */
function retried(world: DurableWorld, resident: Resident, status: Panicked): void {
  world.restart(resident);
  const { replay } = status;
  if (replay !== undefined) {
    resident.feed(resident.starting(replay), status.segmentStartedAt);
  }
  resident.wake(status.segmentStartedAt);
}

/** Advances `resident` as `advance` does, its log records and spawns its host's to read. */
function advanced(world: DurableWorld, resident: Resident, advance: () => void): Advanced {
  const logs: LogRecord[] = [];
  resident.heardBy = (records) => logs.push(...records);
  resident.spawned = [];
  try {
    advance();
    world.drain();
  } finally {
    resident.heardBy = undefined;
  }
  return { state: stateOf(resident), spawned: resident.spawned.splice(0), logs };
}

/** Where `resident` stands, and where each of its executions waits, as it last committed. */
export function inspectionOf(resident: Resident): Inspection {
  return { state: stateOf(resident), waitingAt: waitingAt(resident) };
}

/** Where `resident` stands, as a host reads it. */
function stateOf(resident: Resident): InstanceState {
  if (resident.unstarted) {
    return { kind: 'ready' };
  }
  const { status, run } = resident;
  switch (status.kind) {
    case 'finished':
      return { kind: 'finished', outcome: status.outcome, encoded: status.encoded };
    case 'panicked':
    case 'terminated':
      return { kind: status.kind, message: status.message, trace: status.trace };
    default:
      return {
        kind: 'waiting',
        until: run.timers.next(),
        watching: run.endWatches.persisted().map(({ instance }) => instance),
      };
  }
}
