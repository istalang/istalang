/**
 * Writing a committed instance as its snapshot (format.ts): every object reachable from what the
 * instance keeps (its live executions, its timers, its watches and its context constants), each
 * value with its objects named by id.
 *
 * - A value deeper than `maximumDepth` can't be persisted (§5): writing it fails with
 *   `TooDeep`, which the instance panics with, at the await that would have committed it.
 * - A weak reference names its target only while the target lives, which it does only while
 *   something written holds it, so its target is written then anyway.
 */

import { replacingParts } from '../../definition/values/replacing.ts';
import { depthOf, maximumDepth, type Value } from '../../definition/values/values.ts';
import type { Instance } from '../run/instances.ts';
import {
  Cell,
  Execution,
  Future,
  Reference,
  Resource,
  RunObject,
  WeakReference,
} from '../run/objects.ts';
import type { Run } from '../run/run.ts';
import type { PersistedObject, PersistedRegister, PersistedStatus, Snapshot } from './format.ts';

/** A value nesting deeper than an instance can persist (§5). */
export class TooDeep extends Error {
  override readonly name = 'TooDeep';

  constructor(depth: number) {
    super(`A value nests ${depth} levels deep, deeper than the ${maximumDepth} an instance can persist.`);
  }
}

/** What a snapshot names beside the run: its Definition, its status and its options. */
export interface Written {
  readonly definition: string;
  readonly status: PersistedStatus;
  readonly crashEveryAwait: boolean;
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
      part instanceof RunObject ? { kind: 'handle', object: named(part) } : undefined,
    );
  };
  const state = run.persisted();
  const instance: Instance = run.instance;
  const snapshot = {
    ...written,
    instance: instance.name,
    serial: state.serial,
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
    contextConstants: [...instance.contextConstants].map(
      ([name, value]) => [name, persisted(value)] as [string, Value],
    ),
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

interface Naming {
  readonly named: (object: RunObject) => number;
  readonly persisted: (value: Value) => Value;
}

/** `object` as a snapshot writes it. */
function objectOf(object: RunObject, { named, persisted }: Naming): PersistedObject {
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
      callbacks: object.callbacks.map(({ callback, rank, standing }) => ({
        callback: persisted(callback),
        rank: [...rank],
        standing: persisted(standing),
      })),
      lost: object.lost,
      onAwaited: object.onAwaited.map(persisted),
    };
  }
  if (object instanceof Execution) {
    const { frame } = object;
    return {
      kind: 'execution',
      id,
      future: named(object.future),
      function: frame.function,
      pc: frame.pc,
      registers: frame.registers.map((register) => registerOf(register, { named, persisted })),
      ...(frame.closure === undefined ? {} : { closure: persisted(frame.closure) }),
      parked: object.parked,
      given: object.given.map((given) => registerOf(given, { named, persisted })),
      ...(object.disposing === undefined ? {} : { disposing: named(object.disposing) }),
    };
  }
  if (object instanceof WeakReference) {
    return {
      kind: 'weakReference',
      id,
      ...(object.target === undefined ? {} : { target: named(object.target) }),
      ...(object.disposed === undefined ? {} : { disposed: named(object.disposed) }),
    };
  }
  if (object instanceof Resource) {
    return {
      kind: 'resource',
      id,
      type: object.type,
      payload: object.payload as never,
      disposed: object.disposed,
    };
  }
  throw new Error(`A run object of no kind a snapshot knows, ${id}, is written.`);
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
