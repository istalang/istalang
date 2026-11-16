/**
 * Reading a snapshot (format.ts) back into a fresh run of its instance, so it resumes where it
 * committed (§5).
 *
 * - Objects are made first, each under its id, then filled, so a value may name any of them.
 * - Holders are counted again, as the run that wrote the snapshot counted them: what a counted
 *   register, a counted cell, a future, a call's arguments and a context constant hold each count
 *   once (`Lifetimes.adoptRestored`). A value comes back as a tree, so each composite has the one
 *   holder it is read under.
 */

import { lifetimeOf } from '../../definition/tables/types.ts';
import { replacingParts } from '../../definition/values/replacing.ts';
import type { Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { CodeFunction } from '../../definition/tables/functions.ts';
import {
  Cell,
  Execution,
  Future,
  Reference,
  Resource,
  type RunObject,
  type Step,
  WeakReference,
} from '../run/objects.ts';
import type { Invocation, Run } from '../run/run.ts';
import type { PersistedObject, PersistedRegister, Snapshot } from './format.ts';

/**
 * Reads `snapshot` back into `run`, a fresh run of the instance it names. Its root invocation ends
 * the instance again as it returns; any other is answered as `answers` says, by its future's id, or
 * not at all, its caller gone with the runtime that ran it.
 */
export function restore(
  run: Run,
  snapshot: Snapshot,
  answers: ReadonlyMap<number, Invocation> = new Map(),
): void {
  const objects = new Map<number, RunObject>();
  for (const persisted of snapshot.objects) {
    made(run, persisted, objects);
  }
  const object = (id: number): RunObject =>
    objects.get(id) ?? unreachable(`A snapshot names no object ${id}.`);
  const restored = (value: Value): Value =>
    replacingParts(value, (part) => (part.kind === 'handle' ? (object(part.object) as unknown as Value) : undefined));
  for (const persisted of snapshot.objects) {
    filled(run, persisted, { object, restored });
  }
  const { instance, lifetimes } = run;
  instance.draws = snapshot.draws;
  instance.spawned = snapshot.spawned;
  for (const [name, value] of snapshot.contextConstants) {
    const constant = restored(value);
    instance.contextConstants.set(name, constant);
    run.lifetimes.adoptRestored(constant);
  }
  run.restored({
    serial: snapshot.serial,
    live: snapshot.live.map((id) => object(id) as Execution),
    timers: snapshot.timers.map(({ at, future }) => ({ at, future: object(future) as Future })),
    watches: snapshot.watches.map(({ future, ...watched }) => ({
      future: object(future) as Future,
      ...watched,
    })),
    ready: snapshot.ready.map((ready) => {
      if ('execution' in ready) {
        return { execution: object(ready.execution) as Execution, decision: restored(ready.decision) };
      }
      const call = restored(ready.call);
      const passed = ready.arguments.map(restored);
      for (const held of [call, ...passed]) {
        lifetimes.adoptRestored(held);
      }
      return { call, arguments: passed };
    }),
    invocations: snapshot.invocations.flatMap(({ future, root }) => {
      const invocation = root ? rootInvocation(run) : answers.get(future);
      return invocation === undefined ? [] : [{ future: object(future) as Future, invocation }];
    }),
  });
}

/** Makes the object `persisted` describes, empty, under its id; an execution makes its future. */
function made(run: Run, persisted: PersistedObject, objects: Map<number, RunObject>): void {
  switch (persisted.kind) {
    case 'cell':
      objects.set(persisted.id, new Cell(persisted.id, null, persisted.counted, persisted.dispose));
      return;
    case 'future':
      if (!objects.has(persisted.id)) {
        objects.set(persisted.id, new Future(persisted.id));
      }
      return;
    case 'execution': {
      const execution = new Execution(persisted.id, persisted.future, run.instance);
      objects.set(persisted.id, execution);
      objects.set(persisted.future, execution.future);
      return;
    }
    case 'weakReference':
      objects.set(persisted.id, new WeakReference(persisted.id, undefined as never));
      return;
    case 'resource': {
      const resource = new Resource(persisted.id, persisted.type, persisted.payload);
      resource.disposed = persisted.disposed;
      objects.set(persisted.id, resource);
      return;
    }
    default: {
      const unhandled: never = persisted;
      return unhandled;
    }
  }
}

interface Reading {
  readonly object: (id: number) => RunObject;
  readonly restored: (value: Value) => Value;
}

/** Fills the object `persisted` describes, counting what it holds. */
function filled(run: Run, persisted: PersistedObject, { object, restored }: Reading): void {
  const { lifetimes } = run;
  switch (persisted.kind) {
    case 'cell': {
      const cell = object(persisted.id) as Cell;
      cell.value = restored(persisted.value);
      if (cell.counted) {
        lifetimes.adoptRestored(cell.value);
      }
      return;
    }
    case 'future': {
      const future = object(persisted.id) as Future;
      future.settled = persisted.settled;
      future.value = restored(persisted.value);
      future.lost = persisted.lost;
      future.callbacks = persisted.callbacks.map(({ callback, rank, standing }) => ({
        callback: restored(callback),
        rank,
        standing: restored(standing),
      }));
      future.onAwaited.push(...persisted.onAwaited.map(restored));
      if (future.settled) {
        lifetimes.adoptRestored(future.value);
      }
      for (const held of [...future.callbacks.flatMap(({ callback, standing }) => [callback, standing]), ...future.onAwaited]) {
        lifetimes.adoptRestored(held);
      }
      return;
    }
    case 'execution': {
      const execution = object(persisted.id) as Execution;
      const entry = run.definition.functions[persisted.function] as CodeFunction;
      execution.frame = {
        function: persisted.function,
        pc: persisted.pc,
        registers: persisted.registers.map((register) => registerOf(register, { object, restored })),
        closure: persisted.closure === undefined ? undefined : restored(persisted.closure),
        decision: undefined,
        execution,
        stopping: false,
      };
      execution.parked = persisted.parked;
      execution.given = persisted.given.map(restored);
      if (persisted.disposing !== undefined) {
        execution.disposing = object(persisted.disposing) as Future;
      }
      execution.frame.registers.forEach((register, index) => {
        const slot = entry.registers[index];
        if (slot !== undefined && !slot.borrowed && lifetimeOf(run.definition.types, slot.type) === 'counted') {
          lifetimes.adoptRestored(register as Value | undefined);
        }
      });
      for (const given of execution.given) {
        lifetimes.adoptRestored(given);
      }
      return;
    }
    case 'weakReference': {
      const weak = object(persisted.id) as WeakReference;
      weak.target = persisted.target === undefined ? undefined : object(persisted.target);
      if (persisted.disposed !== undefined) {
        weak.disposed = object(persisted.disposed) as Future;
      }
      run.restoredWeakReference(weak);
      return;
    }
    case 'resource':
      return;
    default: {
      const unhandled: never = persisted;
      return unhandled;
    }
  }
}

/** A frame's register as a snapshot gave it back. */
function registerOf(register: PersistedRegister, { object, restored }: Reading): Value | undefined {
  if (register === null) {
    return undefined;
  }
  if ('reference' in register) {
    const { cell, path } = register.reference;
    return new Reference(object(cell) as Cell, path as readonly Step[]) as unknown as Value;
  }
  return restored(register.value);
}

/** The invocation of an instance's spawned call: its return finishes the instance (§9). */
export function rootInvocation(run: Run): Invocation {
  return {
    answer: (end) => {
      run.instance.ended(end.kind === 'returned' ? { kind: 'finished', outcome: end.value } : end);
    },
    root: true,
  };
}
