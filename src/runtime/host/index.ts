/**
 * The runtime as a host uses it (§9): give it the seams, deploy a Definition, start what it may
 * start, and wake, inspect, retry and terminate the instances its code reaches.
 *
 * - A Definition arrives as its persisted text, the form the store keeps; deploying reads and
 *   validates it, emits its code once per hash, and writes it to the store once.
 * - Instances are the world's (durable-world.ts): each committed to the store at every segment's
 *   end, so a runtime opened over the same store goes on where an earlier one committed (§5). One
 *   the world doesn't hold is read from the store with the Definition its snapshot names.
 * - Starting, waking, retrying or terminating says where the instance stands after (`Advanced`):
 *   waiting, finished with its outcome, panicked or terminated, with the instances it spawned and
 *   the log records its committed segments wrote. Inspecting reads its last commit only.
 */

import { memo } from '../../foundation/structures/memo.ts';
import { locationOf } from '../../definition/traces.ts';
import type { CodeFunction } from '../../definition/tables/functions.ts';
import { copied } from '../../definition/values/replacing.ts';
import { type HostExterns, withHost } from '../boundary/host-natives.ts';
import type { Clock } from '../clock.ts';
import type {
  Advanced,
  Inspection,
  InstanceState,
  LogRecord,
  WaitingPoint,
} from '../instance-state.ts';
import type { Natives } from '../natives.ts';
import { Refusal } from '../refusal.ts';
import { snapshotFormat } from '../snapshot/format.ts';
import type { InstanceStore } from '../store.ts';
import { DurableWorld, type Resident, type WorldProgram } from './durable-world.ts';
import { type DeployedProgram, deployed, type HostReports, readDefinition } from './programs.ts';

export interface RuntimeSeams {
  readonly natives: Natives;
  readonly store: InstanceStore;
  readonly clock: Clock;
  readonly seed: () => Uint8Array;
  readonly host?: HostExterns;
  readonly reports?: HostReports;
}

export interface Runtime {
  readonly deploy: (text: string) => DeployedProgram;
  readonly wake: (instance: string) => Promise<Advanced>;
  readonly retry: (instance: string) => Promise<Advanced>;
  readonly terminate: (instance: string) => Promise<Advanced>;
  readonly inspect: (instance: string) => Inspection;
  readonly programOf: (instance: string) => DeployedProgram;
}

export function createRuntime(seams: RuntimeSeams): Runtime {
  const byHash = new Map<string, WorldProgram>();
  const bound = (text: string): WorldProgram => {
    const { program, canonical } = readDefinition(text);
    return memo(byHash, program.hash, () => {
      seams.store.writeDefinition(program.hash, canonical);
      return program;
    });
  };
  const bind = (hash: string): WorldProgram => {
    const known = byHash.get(hash);
    if (known !== undefined) {
      return known;
    }
    const text = seams.store.readDefinition(hash);
    if (text === undefined) {
      throw new Refusal('unknownDefinition', `The store holds no Definition ${hash}.`);
    }
    return bound(text);
  };
  const world = new DurableWorld(
    { ...seams, natives: withHost(seams.natives, seams.host ?? {}) },
    bind,
  );
  const residentOf = (instance: string): Resident => {
    const resident = world.residents.get(instance) ?? world.load(instance);
    if (resident === undefined) {
      throw new Refusal('unknownInstance', `The store holds no instance '${instance}'.`);
    }
    return resident;
  };
  /** Advances `resident` as `advance` does, its log records and spawns its host's to read. */
  const advanced = (resident: Resident, advance: () => void): Advanced => {
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
  };
  const panicked = (resident: Resident) => {
    if (resident.status.kind !== 'panicked') {
      throw new Refusal('notPanicked', `'${resident.name}' hasn't panicked.`);
    }
    return resident.status;
  };
  return {
    deploy: (text) => deployed(world, bound(text)),
    wake: (instance) => {
      const resident = residentOf(instance);
      return Promise.resolve(
        resident.ended ? { state: stateOf(resident), spawned: [], logs: [] } : advanced(resident, () => world.wake(resident)),
      );
    },
    retry: (instance) => {
      const resident = residentOf(instance);
      const status = panicked(resident);
      return Promise.resolve(
        advanced(resident, () => {
          world.restart(resident);
          const { replay } = status;
          if (replay !== undefined) {
            world.feed(resident, (run) => world.spawned(resident, run, copied(replay)), status.segmentStartedAt);
          }
          world.wake(resident, status.segmentStartedAt);
        }),
      );
    },
    terminate: (instance) => {
      const resident = residentOf(instance);
      const { message, trace } = panicked(resident);
      return Promise.resolve(advanced(resident, () => world.terminate(resident, { message, trace })));
    },
    inspect: (instance) => {
      const resident = residentOf(instance);
      return { state: stateOf(resident), waitingAt: waitingAt(resident) };
    },
    programOf: (instance) => deployed(world, residentOf(instance).program),
  };
}

/** Where `resident` stands, as a host reads it. */
function stateOf(resident: Resident): InstanceState {
  if (resident.unstarted) {
    return { kind: 'ready' };
  }
  const { status, run } = resident;
  switch (status.kind) {
    case 'finished':
      return { kind: 'finished', outcome: status.outcome };
    case 'panicked':
    case 'terminated':
      return { kind: status.kind, message: status.message, trace: status.trace };
    default:
      return {
        kind: 'waiting',
        until: run.nextTimer(),
        watching: run.persisted().watches.map(({ instance }) => instance),
      };
  }
}

/**
 * Where each of `resident`'s parked executions waits, as it last committed: its waypoint and the
 * source of its await.
 */
function waitingAt(resident: Resident): readonly WaitingPoint[] {
  const { definition } = resident.program;
  if (resident.text === undefined) {
    return [];
  }
  const { objects, live } = snapshotFormat.read(resident.text);
  const executions = new Map(objects.flatMap((object) => (object.kind === 'execution' ? [[object.id, object]] : [])));
  return live.flatMap((id) => {
    const execution = executions.get(id);
    if (execution === undefined || !execution.parked) {
      return [];
    }
    const entry = definition.functions[execution.function] as CodeFunction;
    const park = entry.instructions[execution.pc - entry.instructions.length];
    return park?.kind === 'park'
      ? [{ waypoint: park.waypoint, location: locationOf(definition, entry.module, park.span.start) }]
      : [];
  });
}

