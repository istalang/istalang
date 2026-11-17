/**
 * Reading a snapshot (format.ts) back into a fresh run of its instance, so it resumes where it
 * committed (§5).
 *
 * - Objects are made first, each under its id, then filled, so a value may name any of them.
 * - A snapshot that doesn't fit its Definition is refused before anything of it resumes: one naming
 *   an object it doesn't hold, or an execution whose frame its entry couldn't have parked.
 * - Holders are counted again, as the run that wrote the snapshot counted them: what a counted
 *   register, a counted cell, a future, a call's arguments and a context constant hold each count
 *   once (`Lifetimes.adoptRestored`). A value comes back as a tree, so each composite has the one
 *   holder it is read under.
 */

import { runsOnFrames } from '../../codegen/entry.ts';
import { parkAt } from '../../codegen/instructions.ts';
import type { Definition } from '../../definition/definition.ts';
import { type CodeFunction, transientRegistersOf } from '../../definition/tables/functions.ts';
import { lifetimeOf } from '../../definition/tables/types.ts';
import { replacingParts } from '../../definition/values/replacing.ts';
import type { Value } from '../../definition/values/values.ts';
import { type Handlers, handlerOf } from '../../foundation/structures/kind-table.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { Refusal } from '../refusal.ts';
import type { InstanceEnd } from '../run/instances.ts';
import { hearsNothing, type Invocation } from '../run/invocations.ts';
import { Cell } from '../run/objects/cell.ts';
import { Execution, type Frame } from '../run/objects/execution.ts';
import { closuresOf, Future } from '../run/objects/future.ts';
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
  const objects = madeObjects(run, snapshot);
  // A store's snapshot naming an object it doesn't hold doesn't fit its instance: refused, as a
  // host's, before anything of it resumes.
  const object = (id: number): RunObject => {
    const found = objects.get(id);
    if (found === undefined) {
      throw new Refusal('snapshotMismatch', `The snapshot names no object ${id}.`);
    }
    return found;
  };
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
    instance.contextConstants.made(name, constant);
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

/**
 * The objects `snapshot` names, by id, made empty, a disposed one marked before anything holding it
 * is filled, so it counts no holder (§7).
 */
function madeObjects(run: Run, snapshot: Snapshot): Map<number, RunObject> {
  const objects = new Map<number, RunObject>();
  for (const persisted of snapshot.objects) {
    made(run, persisted, objects);
  }
  for (const { id, disposed } of snapshot.objects) {
    const disposedObject = disposed === true ? objects.get(id) : undefined;
    if (disposedObject !== undefined) {
      disposedObject.disposed = true;
    }
  }
  return objects;
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
    objects.set(persisted.id, new Resource(persisted.id, persisted.type, persisted.payload));
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
    future.callbacks = persisted.callbacks.map(({ callback, rank, standing, cancelled }) => ({
      callback: restored(callback),
      rank,
      standing: restored(standing),
      cancelled: restored(cancelled),
    }));
    future.onAwaited.push(...persisted.onAwaited.map(restored));
    const held = [
      ...(future.settled ? [future.value] : []),
      ...future.callbacks.flatMap(closuresOf),
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
    if (persisted.whenDisposed !== undefined) {
      weak.whenDisposed = object(persisted.whenDisposed) as Future;
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
  const entry = fittingEntry(run.definition, persisted);
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
  execution.awaiting = persisted.awaiting.map(restored);
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
  for (const held of [...execution.given, ...execution.awaiting]) {
    run.lifetimes.adoptRestored(held);
  }
  for (const { cell } of execution.transients.kept) {
    if (cell.counted) {
      run.lifetimes.hold(cell);
    }
  }
}

/**
 * The entry `persisted`'s frame runs; refused, before anything resumes, unless the frame fits it:
 * an async code entry, standing where one of its `park`s resumes, with each of its registers.
 */
function fittingEntry(
  definition: Definition,
  persisted: Extract<PersistedObject, { readonly kind: 'execution' }>,
): CodeFunction {
  const { id, pc, registers } = persisted;
  const entry = definition.functions[persisted.function];
  const refused = (why: string) =>
    new Refusal('snapshotMismatch', `The snapshot's execution ${id} ${why}.`);
  if (entry?.kind !== 'code' || !runsOnFrames(entry)) {
    throw refused(`runs ${persisted.function}, no async code entry`);
  }
  if (parkAt(entry, pc) === undefined) {
    throw refused(`stands at ${pc}, where no call of ${entry.name} waits`);
  }
  if (registers.length !== entry.registers.length) {
    throw refused(
      `has ${registers.length} registers, where ${entry.name} has ${entry.registers.length}`,
    );
  }
  return entry;
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
      if (end.kind === 'unanswered') {
        unreachable("An instance's root call waits on no end, its own being the instance's.");
      }
      run.instance.ended(
        end.kind === 'returned' ? finished(run, end.value, end.holder, encoder) : end,
      );
    },
    root: true,
    hears: hearsNothing,
  };
}

/**
 * How `run`'s instance ends, its root call having returned `outcome`, which `holder` holds: its
 * outcome encoded by `encoder` in the instance (§9), as a mock replacing it answers, then the run
 * finished, letting go of `holder` and of all else the instance holds (§7); panicked if encoding
 * or a disposal panics.
 */
function finished(
  run: Run,
  outcome: Value,
  holder: Value,
  encoder: number | undefined,
): InstanceEnd {
  try {
    const encoded = encoder === undefined ? {} : { encoded: run.call(encoder, [outcome]) as Value };
    run.finish([holder]);
    return { kind: 'finished', outcome, ...encoded };
  } catch (error) {
    return { kind: 'panicked', ...run.traces.panicOf(error) };
  }
}
