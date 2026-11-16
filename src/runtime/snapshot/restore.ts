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

import { type CodeFunction, transientRegistersOf } from '../../definition/tables/functions.ts';
import { lifetimeOf } from '../../definition/tables/types.ts';
import { replacingParts } from '../../definition/values/replacing.ts';
import type { Value } from '../../definition/values/values.ts';
import { type Handlers, handlerOf } from '../../foundation/structures/kind-table.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { InstanceEnd } from '../run/instances.ts';
import type { Invocation } from '../run/invocations.ts';
import { Cell } from '../run/objects/cell.ts';
import { Execution, type Frame } from '../run/objects/execution.ts';
import { Future } from '../run/objects/future.ts';
import { MockObject } from '../run/objects/mock-object.ts';
import { Reference, type Step } from '../run/objects/reference.ts';
import { Resource } from '../run/objects/resource.ts';
import type { RunObject } from '../run/objects/run-object.ts';
import { WeakReference } from '../run/objects/weak-reference.ts';
import type { Run } from '../run/run.ts';
import { TransientScope } from '../run/transient-scope.ts';
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
    replacingParts(value, (part) =>
      part.kind === 'handle' ? (object(part.object) as unknown as Value) : undefined,
    );
  for (const persisted of snapshot.objects) {
    filled(run, persisted, { object, restored });
  }
  run.arrivals.restoredObjects(objects);
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
        return {
          execution: object(ready.execution) as Execution,
          decision: restored(ready.decision),
        };
      }
      const call = restored(ready.call);
      const passed = ready.arguments.map(restored);
      for (const held of [call, ...passed]) {
        lifetimes.adoptRestored(held);
      }
      return { call, arguments: passed };
    }),
    invocations: snapshot.invocations.flatMap(({ future: id, root }) => {
      // A call into the instance holds its future while it runs, as the run starting it does, so
      // its work goes on to its end even with no caller left to answer (§9).
      const future = object(id) as Future;
      lifetimes.adoptRestored(future as unknown as Value);
      const invocation = root ? rootInvocation(run, snapshot.encoder) : answers.get(id);
      return invocation === undefined ? [] : [{ future, invocation }];
    }),
  });
}

/** Makes the object `persisted` describes, empty, under its id; an execution makes its future. */
function made(run: Run, persisted: PersistedObject, objects: Map<number, RunObject>): void {
  handlerOf(makers, persisted)({ run, objects }, persisted);
}

const makers: Handlers<
  { readonly run: Run; readonly objects: Map<number, RunObject> },
  PersistedObject,
  [],
  void
> = {
  cell: ({ objects }, cell) => {
    objects.set(cell.id, new Cell(cell.id, null, cell.counted, cell.dispose));
  },
  future: ({ objects }, future) => {
    if (!objects.has(future.id)) {
      objects.set(future.id, new Future(future.id));
    }
  },
  execution: ({ run, objects }, persisted) => {
    const execution = new Execution(persisted.id, persisted.future, run.instance);
    objects.set(persisted.id, execution);
    objects.set(persisted.future, execution.future);
  },
  weakReference: ({ objects }, weak) => {
    objects.set(weak.id, new WeakReference(weak.id, undefined as never));
  },
  resource: ({ objects }, persisted) => {
    const resource = new Resource(persisted.id, persisted.type, persisted.payload);
    resource.disposed = persisted.disposed;
    objects.set(persisted.id, resource);
  },
  mock: ({ objects }, persisted) => {
    objects.set(persisted.id, new MockObject(persisted.id, persisted.target, null));
  },
};

interface Reading {
  readonly object: (id: number) => RunObject;
  readonly restored: (value: Value) => Value;
}

/** Fills the object `persisted` describes, counting what it holds. */
function filled(run: Run, persisted: PersistedObject, reading: Reading): void {
  handlerOf(fillers, persisted)({ run, ...reading }, persisted);
}

const fillers: Handlers<{ readonly run: Run } & Reading, PersistedObject, [], void> = {
  cell: ({ run, object, restored }, persisted) => {
    const cell = object(persisted.id) as Cell;
    cell.value = restored(persisted.value);
    if (cell.counted) {
      run.lifetimes.adoptRestored(cell.value);
    }
  },
  future: ({ run, object, restored }, persisted) => {
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
    const held = [
      ...(future.settled ? [future.value] : []),
      ...future.callbacks.flatMap(({ callback, standing }) => [callback, standing]),
      ...future.onAwaited,
    ];
    for (const each of held) {
      run.lifetimes.adoptRestored(each);
    }
  },
  execution: (reading, persisted) => {
    filledExecution(reading, persisted);
  },
  weakReference: ({ run, object }, persisted) => {
    const weak = object(persisted.id) as WeakReference;
    weak.target = persisted.target === undefined ? undefined : object(persisted.target);
    if (persisted.disposed !== undefined) {
      weak.disposed = object(persisted.disposed) as Future;
    }
    run.weakReferences.restored(weak);
  },
  resource: ({ run, object }, persisted) => {
    run.resources.restored(object(persisted.id) as Resource);
  },
  mock: ({ run, object, restored }, persisted) => {
    const mock = object(persisted.id) as MockObject;
    mock.replacement = restored(persisted.replacement);
    mock.calls.push(...persisted.calls.map(restored));
    for (const held of [mock.replacement, ...mock.calls]) {
      run.lifetimes.adoptRestored(held);
    }
    run.mocking.held.hold(mock);
  },
};

/**
 * Fills a persisted execution: its frame, what it was given, the transients' cells it keeps, each
 * counted register held.
 */
function filledExecution(
  { run, ...reading }: { readonly run: Run } & Reading,
  persisted: Extract<PersistedObject, { readonly kind: 'execution' }>,
): void {
  const { object, restored } = reading;
  const execution = object(persisted.id) as Execution;
  const entry = run.definition.functions[persisted.function] as CodeFunction;
  execution.frame = {
    function: persisted.function,
    pc: persisted.pc,
    registers: persisted.registers.map((register) => registerOf(register, reading)),
    closure: persisted.closure === undefined ? undefined : restored(persisted.closure),
    decision: undefined,
    execution,
    stopping: false,
  };
  execution.parked = persisted.parked;
  execution.given = persisted.given.map((given) => registerOf(given, reading) ?? null);
  execution.transients = transientsOf(entry, execution.frame, persisted, object);
  if (persisted.disposing !== undefined) {
    execution.disposing = object(persisted.disposing) as Future;
  }
  execution.frame.registers.forEach((register, index) => {
    const slot = entry.registers[index];
    if (
      slot !== undefined &&
      !slot.borrowed &&
      lifetimeOf(run.definition.types, slot.type) === 'counted'
    ) {
      run.lifetimes.adoptRestored(register as Value | undefined);
    }
  });
  for (const given of execution.given) {
    run.lifetimes.adoptRestored(given);
  }
  for (const { cell } of execution.transients.kept) {
    if (cell.counted) {
      run.lifetimes.hold(cell);
    }
  }
}

/**
 * The transients' scope of a persisted execution: the cells it kept, then its frame's own shares,
 * which its transient registers hold (run/transients.ts).
 */
function transientsOf(
  entry: CodeFunction,
  frame: Frame,
  persisted: Extract<PersistedObject, { readonly kind: 'execution' }>,
  object: (id: number) => RunObject,
): TransientScope {
  const kept = (persisted.transients ?? []).map(({ cell, ...transient }) => ({
    ...transient,
    cell: object(cell) as Cell,
  }));
  const scope = new TransientScope(kept);
  for (const register of transientRegistersOf(entry)) {
    const cell = frame.registers[register];
    if (cell instanceof Cell) {
      scope.share(frame.function, register, cell);
    }
  }
  return scope;
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
export function rootInvocation(run: Run, encoder: number | undefined): Invocation {
  return {
    answer: (end) => {
      run.instance.ended(end.kind === 'returned' ? finished(run, end.value, encoder) : end);
    },
    root: true,
    hears: false,
  };
}

/**
 * How `run`'s instance ends, its root call having returned `outcome`: finished, its outcome encoded
 * by `encoder` in the instance (§9), as a mock replacing it answers; panicked if encoding panics.
 */
function finished(run: Run, outcome: Value, encoder: number | undefined): InstanceEnd {
  if (encoder === undefined) {
    return { kind: 'finished', outcome };
  }
  try {
    return { kind: 'finished', outcome, encoded: run.call(encoder, [outcome]) as Value };
  } catch (error) {
    return { kind: 'panicked', ...run.traces.panicOf(error) };
  }
}
