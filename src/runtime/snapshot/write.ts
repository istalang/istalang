/**
 * Writing a committed instance as its snapshot (format.ts): every object reachable from what the
 * instance keeps (its live executions, its timers, its watches and its context constants), each
 * value with its objects named by id.
 *
 * - A value deeper than `maximumDepth` can't be persisted (§5): writing it fails with
 *   `TooDeep`, which the instance panics with, at the await that would have committed it.
 * - A finished instance's outcome is written as any value is, a disposable one naming its object.
 * - A weak reference names its target only while the target lives, which it does only while
 *   something written holds it, so its target is written then anyway.
 */

import { bytesToHex } from '@noble/hashes/utils.js';
import { replacingParts } from '../../definition/values/replacing.ts';
import { depthOf, handleTo, maximumDepth, type Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { Instance } from '../run/instances.ts';
import { Cell } from '../run/objects/cell.ts';
import { Execution } from '../run/objects/execution.ts';
import { Future } from '../run/objects/future.ts';
import { MockObject } from '../run/objects/mock-object.ts';
import { Reference } from '../run/objects/reference.ts';
import { Resource } from '../run/objects/resource.ts';
import { RunObject } from '../run/objects/run-object.ts';
import { WeakReference } from '../run/objects/weak-reference.ts';
import type { Run } from '../run/run.ts';
import type { PersistedObject, PersistedRegister, PersistedStatus, Snapshot } from './format.ts';

/** A value nesting deeper than an instance can persist (§5). */
export class TooDeep extends Error {
  override readonly name = 'TooDeep';

  constructor(depth: number) {
    super(
      `A value nests ${depth} levels deep, deeper than the ${maximumDepth} an instance can persist.`,
    );
  }
}

/** What a snapshot names beside the run: its Definition, its status and its options. */
export interface Written {
  readonly definition: string;
  readonly status: PersistedStatus;
  readonly crashEveryAwait: boolean;
  readonly terminatesOnPanic: boolean;
}

/** `run`'s instance as a snapshot; throws `TooDeep` for a value too deep to persist. */
export function snapshotOf(run: Run, written: Written): Snapshot {
  const objects = new Map<number, PersistedObject | undefined>();
  const pending: RunObject[] = [];
  const named = (object: RunObject): number => {
    if (!objects.has(object.object)) {
      objects.set(object.object, undefined);
      pending.push(object);
    }
    return object.object;
  };
  const persisted = (value: Value): Value => {
    const depth = depthOf(value);
    if (depth > maximumDepth) {
      throw new TooDeep(depth);
    }
    return replacingParts(value, (part) =>
      part instanceof RunObject ? handleTo(named(part)) : undefined,
    );
  };
  const state = run.persisted();
  const instance: Instance = run.instance;
  const snapshot = {
    ...written,
    status: statusOf(written.status, persisted),
    instance: instance.name,
    serial: state.serial,
    seed: bytesToHex(run.seed),
    draws: instance.draws,
    spawned: instance.spawned,
    live: state.live.map(named),
    timers: state.timers.map(({ at, future }) => ({ at, future: named(future) })),
    watches: state.watches.map(({ future, ...watched }) => ({ future: named(future), ...watched })),
    ready: state.ready.map((ready) =>
      'execution' in ready
        ? { execution: named(ready.execution), decision: persisted(ready.decision) }
        : { call: persisted(ready.call), arguments: ready.arguments.map(persisted) },
    ),
    invocations: state.invocations.map(({ future, invocation }) => ({
      future: named(future),
      root: invocation.root,
    })),
    contextConstants: instance.contextConstants
      .entries()
      .map(([name, value]) => [name, persisted(value)] as [string, Value]),
  };
  for (let object = pending.pop(); object !== undefined; object = pending.pop()) {
    objects.set(object.object, objectOf(object, { named, persisted }));
  }
  return {
    ...snapshot,
    objects: [...objects.values()]
      .filter((each): each is PersistedObject => each !== undefined)
      .toSorted((first, second) => first.id - second.id),
  };
}

/** `status` as a snapshot writes it: a finished one's outcome with its objects named by id. */
function statusOf(status: PersistedStatus, persisted: Naming['persisted']): PersistedStatus {
  if (status.kind !== 'finished') {
    return status;
  }
  const { outcome, encoded } = status;
  return {
    kind: 'finished',
    outcome: persisted(outcome),
    ...(encoded === undefined ? {} : { encoded: persisted(encoded) }),
  };
}

interface Naming {
  readonly named: (object: RunObject) => number;
  readonly persisted: (value: Value) => Value;
}

/** `object` as a snapshot writes it. */
function objectOf(object: RunObject, naming: Naming): PersistedObject {
  return { ...fieldsOf(object, naming), ...(object.disposed ? { disposed: true } : {}) };
}

/** What `object` states as its kind's. */
function fieldsOf(object: RunObject, { named, persisted }: Naming): PersistedObject {
  const id = object.object;
  if (object instanceof Cell) {
    return {
      kind: 'cell',
      id,
      value: persisted(object.value),
      counted: object.counted,
      ...(object.dispose === undefined ? {} : { dispose: object.dispose }),
    };
  }
  if (object instanceof Future) {
    return {
      kind: 'future',
      id,
      settled: object.settled,
      value: persisted(object.value),
      callbacks: object.callbacks.map(({ callback, rank, standing, cancelled }) => ({
        callback: persisted(callback),
        rank: [...rank],
        standing: persisted(standing),
        cancelled: persisted(cancelled),
      })),
      lost: object.lost,
      onAwaited: object.onAwaited.map(persisted),
      converters: object.converters.map(persisted),
    };
  }
  if (object instanceof Execution) {
    return executionOf(object, { named, persisted });
  }
  if (object instanceof WeakReference) {
    return {
      kind: 'weakReference',
      id,
      ...(object.target === undefined ? {} : { target: named(object.target) }),
      ...(object.whenDisposed === undefined ? {} : { whenDisposed: named(object.whenDisposed) }),
    };
  }
  if (object instanceof Resource) {
    return {
      kind: 'resource',
      id,
      type: object.type,
      payload: object.payload as never,
    };
  }
  if (object instanceof MockObject) {
    return {
      kind: 'mock',
      id,
      target: object.target,
      replacement: persisted(object.replacement),
      calls: object.calls.map(persisted),
    };
  }
  throw new Error(`A run object of no kind a snapshot knows, ${id}, is written.`);
}

/** `execution`, its frame record, what it was given and what it keeps, as a snapshot writes it. */
function executionOf(execution: Execution, { named, persisted }: Naming): PersistedObject {
  const { frame } = execution;
  const { kept } = execution.transients;
  return {
    kind: 'execution',
    id: execution.object,
    future: named(execution.future),
    function: frame.function,
    parkedAt: frame.parkedAt ?? unreachable('A frame a snapshot keeps stands at a park.'),
    registers: frame.registers.map((register) => registerOf(register, { named, persisted })),
    ...(frame.closure === undefined ? {} : { closure: persisted(frame.closure) }),
    parked: execution.parked,
    given: execution.given.map((given) => registerOf(given, { named, persisted })),
    awaiting: execution.awaiting.map(persisted),
    ...(execution.disposing === undefined ? {} : { disposing: named(execution.disposing) }),
    ...(kept.length === 0
      ? {}
      : {
          transients: kept.map(({ cell, ...transient }) => ({ ...transient, cell: named(cell) })),
        }),
  };
}

/** What a frame's register holds, as a snapshot writes it. */
function registerOf(register: unknown, { named, persisted }: Naming): PersistedRegister {
  if (register === undefined) {
    return null;
  }
  if (register instanceof Reference) {
    return { reference: { cell: named(register.cell), path: [...register.path] as never } };
  }
  return { value: persisted(register as Value) };
}
