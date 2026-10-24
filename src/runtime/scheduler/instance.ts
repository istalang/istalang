/**
 * A running instance in memory: its heap objects, with executions as live frames, the executions
 * ready to run, and its status (spec §5). It is made from a snapshot, or for a new instance from
 * `main`, and turned back into a snapshot at every commit; the scheduler runs it in between
 * (segment.ts, wake.ts).
 *
 * - Ids grow with creation (snapshot/objects.ts). The next id is one past the highest live one,
 *   so it is never stored; an id freed by a commit may come back, but nothing refers to it.
 * - An execution waits at its top frame's `await`: what it waits on is read from that
 *   instruction's register, never stored. Resolving a future readies its waiters in id order,
 *   which is creation order. A ready execution is always at an `await` whose future has resolved.
 * - The root execution, `main`'s, is the one no call future names.
 * - A commit keeps only what an execution can reach (§5). A future no register holds any more is
 *   left out; disposal (§7) will decide what losing a last holder does, and until then nothing can
 *   observe it.
 */

import type { Definition } from '../../definition/definition.ts';
import { awaitedRegisters } from '../../definition/instructions/flow.ts';
import type { FunctionId } from '../../definition/operands.ts';
import { handleTarget, type Value } from '../../definition/values.ts';
import type { FunctionTable } from '../interpreter/function-table.ts';
import { type ActiveFrame, newFrame, readRegister, resumeAt } from '../interpreter/machine.ts';
import { type Frame, type HeapObject, isReference } from '../snapshot/objects.ts';
import { referencedObjects, type Snapshot } from '../snapshot/snapshot.ts';

/** A Definition as the runtime runs it: loaded, bound to its natives, and named by its hash. */
export interface LoadedDefinition {
  readonly definition: Definition;
  readonly hash: string;
  readonly functions: FunctionTable;
}

export interface LiveExecution {
  readonly kind: 'execution';
  readonly id: number;
  /** The call stack, innermost frame last. */
  readonly frames: ActiveFrame[];
  readonly disposing: boolean;
}

type FutureObject = Extract<HeapObject, { kind: 'future' }>;
type FutureState = FutureObject['state'];

/** A heap object as the running instance holds it. */
export type LiveObject = Exclude<HeapObject, { kind: 'execution' }> | LiveExecution;

export type InstanceStatus = Snapshot['status'];

/** What an instance is made of, as a snapshot records it. */
type Contents = Pick<Snapshot, 'ready' | 'crashEveryAwait'> & {
  readonly objects: readonly LiveObject[];
};

/** How a new instance runs: options it keeps for its whole life (§10). */
export interface StartOptions {
  /** Every segment runs twice, the first run discarded, before it commits. */
  readonly crashEveryAwait?: boolean;
}

export class Instance {
  readonly loaded: LoadedDefinition;
  readonly name: string;
  readonly crashEveryAwait: boolean;
  readonly #objects: Map<number, LiveObject>;
  readonly #ready: number[];

  private constructor(loaded: LoadedDefinition, name: string, contents: Contents) {
    this.loaded = loaded;
    this.name = name;
    this.crashEveryAwait = contents.crashEveryAwait;
    this.#objects = new Map(contents.objects.map((object) => [object.id, object]));
    this.#ready = [...contents.ready];
  }

  /** A new instance whose root execution is about to run `main` from its start. */
  static start(
    loaded: LoadedDefinition,
    name: string,
    main: FunctionId,
    { crashEveryAwait = false }: StartOptions,
  ): Instance {
    const instance = new Instance(loaded, name, { objects: [], ready: [], crashEveryAwait });
    instance.startExecution(main, []);
    return instance;
  }

  /** The instance a committed snapshot describes. */
  static restore(loaded: LoadedDefinition, snapshot: Snapshot): Instance {
    const objects = snapshot.objects.map(
      (object): LiveObject =>
        object.kind === 'execution'
          ? { ...object, frames: object.frames.map((frame) => liveFrame(loaded.definition, frame)) }
          : object,
    );
    return new Instance(loaded, snapshot.instance, { ...snapshot, objects });
  }

  /** The instance as a snapshot with `status`, holding only what an execution can reach. */
  snapshot(status: Exclude<InstanceStatus, { kind: 'panicked' }>): Snapshot {
    const active = status.kind === 'active';
    return {
      definition: this.loaded.hash,
      instance: this.name,
      status,
      crashEveryAwait: this.crashEveryAwait,
      objects: active ? this.#reachableObjects() : [],
      ready: active ? [...this.#ready] : [],
    };
  }

  /** A new execution about to run function `entry` with `argumentValues`. */
  startExecution(entry: FunctionId, argumentValues: readonly Value[]): LiveExecution {
    const code = this.loaded.definition.functions[entry];
    if (code?.kind !== 'code') {
      throw new Error(`Entry ${entry} is not code.`);
    }
    return this.#add((id) => ({
      kind: 'execution',
      id,
      frames: [newFrame(entry, code, argumentValues)],
      disposing: false,
    }));
  }

  /** A handle to a new future in `state`. */
  newFuture(state: FutureState): Value {
    const future = this.#add((id): FutureObject => ({ kind: 'future', id, state }));
    return { kind: 'handle', object: future.id };
  }

  /** The future of the async call `execution` runs; undefined for the root. */
  callFutureOf(execution: LiveExecution): number | undefined {
    for (const object of this.#objects.values()) {
      if (
        object.kind === 'future' &&
        object.state.kind === 'call' &&
        object.state.execution === execution.id
      ) {
        return object.id;
      }
    }
    return undefined;
  }

  /** Whether no execution is ready to run. */
  get idle(): boolean {
    return this.#ready.length === 0;
  }

  /** Queues `execution` to run after the executions already ready. */
  markReady(execution: LiveExecution): void {
    this.#ready.push(execution.id);
  }

  /** Whether the future `handle` names has resolved. */
  isResolved(handle: Value): boolean {
    return this.#future(handle).state.kind === 'resolved';
  }

  /** Resolves the pending future `id` with `value`, readying every execution waiting on it. */
  resolve(id: number, value: Value): void {
    const future = this.#futureById(id);
    this.#objects.set(id, { ...future, state: { kind: 'resolved', value } });
    for (const object of this.#objects.values()) {
      if (object.kind === 'execution' && waitsOn(object, id)) {
        this.markReady(object);
      }
    }
  }

  /** Resolves every timer due at `now`, earliest first. */
  resolveDueTimers(now: bigint): void {
    const due = [...this.#objects.values()]
      .flatMap((object) =>
        object.kind === 'future' && object.state.kind === 'timer' && object.state.at <= now
          ? [{ id: object.id, at: object.state.at }]
          : [],
      )
      .sort((first, second) =>
        first.at === second.at ? first.id - second.id : Number(first.at - second.at),
      );
    for (const { id } of due) {
      this.resolve(id, null);
    }
  }

  /** The next ready execution, moved past its `await` with the value it waited for. */
  resumeNext(): LiveExecution | undefined {
    const id = this.#ready.shift();
    if (id === undefined) {
      return undefined;
    }
    const execution = this.#execution(id);
    const frame = topFrame(execution);
    const instruction = frame.code.instructions[frame.pc];
    if (instruction?.kind !== 'await') {
      throw new Error(`Ready execution ${id} is not at an await.`);
    }
    const future = this.#future(readRegister(frame, instruction.future));
    if (future.state.kind !== 'resolved') {
      throw new Error(`Ready execution ${id} waits on an unresolved future.`);
    }
    resumeAt(frame, instruction.dst, future.state.value);
    return execution;
  }

  /** The root execution, which no call future names; undefined once `main` has returned. */
  root(): LiveExecution | undefined {
    for (const object of this.#objects.values()) {
      if (object.kind === 'execution' && this.callFutureOf(object) === undefined) {
        return object;
      }
    }
    return undefined;
  }

  /** Removes a finished execution. */
  remove(execution: LiveExecution): void {
    this.#objects.delete(execution.id);
  }

  #add<Object extends LiveObject>(make: (id: number) => Object): Object {
    const object = make(Math.max(-1, ...this.#objects.keys()) + 1);
    this.#objects.set(object.id, object);
    return object;
  }

  #execution(id: number): LiveExecution {
    const object = this.#objects.get(id);
    if (object?.kind !== 'execution') {
      throw new Error(`Object ${id} is not an execution.`);
    }
    return object;
  }

  #future(handle: Value): FutureObject {
    const id = handleTarget(handle);
    if (id === undefined) {
      throw new TypeError('Expected a future handle.');
    }
    return this.#futureById(id);
  }

  #futureById(id: number): FutureObject {
    const object = this.#objects.get(id);
    if (object?.kind !== 'future') {
      throw new Error(`Object ${id} is not a future.`);
    }
    return object;
  }

  /** The heap as a snapshot stores it, without what no execution can reach. */
  #reachableObjects(): HeapObject[] {
    const stored = new Map(
      [...this.#objects.values()].map((object) => [object.id, storedObject(object)]),
    );
    const reached = new Set<number>();
    const pending: HeapObject[] = [...stored.values()].filter(
      (object) => object.kind === 'execution',
    );
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (!reached.has(next.id)) {
        reached.add(next.id);
        pending.push(...referencedObjects(next).flatMap((id) => stored.get(id) ?? []));
      }
    }
    return [...reached]
      .sort((first, second) => first - second)
      .flatMap((id) => stored.get(id) ?? []);
  }
}

/** The innermost frame of `execution`, which always has one. */
export function topFrame(execution: LiveExecution): ActiveFrame {
  const frame = execution.frames.at(-1);
  if (frame === undefined) {
    throw new Error(`Execution ${execution.id} has no frame.`);
  }
  return frame;
}

/** Whether `execution` waits on the future `id` at its top frame. */
function waitsOn(execution: LiveExecution, id: number): boolean {
  const frame = topFrame(execution);
  const instruction = frame.code.instructions[frame.pc];
  return (
    instruction !== undefined &&
    awaitedRegisters(instruction).some((register) => handleTarget(frame.registers[register]) === id)
  );
}

function liveFrame(definition: Definition, frame: Frame): ActiveFrame {
  const code = definition.functions[frame.function];
  if (code?.kind !== 'code') {
    throw new Error(`Frame function ${frame.function} is not code; loading checks this.`);
  }
  if (frame.kept.length > 0) {
    throw new Error("The runtime doesn't restore kept holdings yet.");
  }
  const live = newFrame(frame.function, code, []);
  for (const [register, contents] of frame.registers) {
    if (isReference(contents)) {
      throw new Error("The runtime doesn't restore references yet.");
    }
    live.registers[register] = contents;
  }
  live.pc = frame.pc;
  return live;
}

function storedObject(object: LiveObject): HeapObject {
  if (object.kind !== 'execution') {
    return object;
  }
  return {
    ...object,
    frames: object.frames.map((frame) => ({
      function: frame.function,
      pc: frame.pc,
      registers: frame.registers.flatMap((contents, register) =>
        contents === undefined ? [] : [[register, contents] as [number, Value]],
      ),
      kept: [],
    })),
  };
}
