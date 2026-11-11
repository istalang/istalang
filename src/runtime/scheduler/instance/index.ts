/**
 * A running instance in memory: its heap, the executions ready to run, and what its segment
 * spawned (spec §5, §9). It is made from a snapshot, a new instance's `unstarted` one included,
 * turned back into a snapshot at every commit, and runs on from it (`continueFrom`, ../resident.ts);
 * the scheduler runs it in between (../segment/, wake.ts).
 *
 * - An execution waits at its top frame's `await` or `select`, on the wait its register holds
 *   (waits.ts). It is ready once that is decided, and executions run in the order they became
 *   ready (§6), among the callbacks resolvers readied (ready.ts).
 * - The root execution, the one the instance started with, is the one that resolves no call
 *   future.
 * - A commit keeps the executions and what they hold (§5, runtime/lifetimes/holders.ts). Whatever
 *   was disposable and lost its last holder was disposed where it lost it, so what is left out is
 *   only what no one can observe any more.
 * - Stopping an execution (§7: its call future disposed) lets go of everything its frames hold.
 * - What a segment spawns becomes instances only when the segment commits (wake.ts), so a segment
 *   that is discarded spawned nothing. So do the answers it gave other instances' calls to its
 *   mocks (§10): each fills its caller's future once the segment commits. The log records it wrote
 *   reach the host only then too (§3.8 `log`).
 * - Its random values are draws from the source its snapshot keeps (random.ts), counted
 *   from the draws committed before the segment, so a segment that runs again draws the same ones.
 *   Each instance it spawns is seeded with the first bytes of a draw.
 * - A mock this instance holds replaces its target for the calls it makes itself (`mockOf`); one an
 *   instance it descends from holds replaces it too, through the runtime running the test.
 * - The instance is its frames' heap (interpreter/machine.ts): a variable passed by `&` is a cell
 *   object here, a reference names one, and what a frame lets go of is noted on the heap.
 * - A live run (proposal 8) runs on one too, made from an `unstarted` snapshot and never turned
 *   back into one (../live-run.ts): what it spawns, logs and draws is never committed.
 */

import type { FunctionId } from '../../../definition/operands.ts';
import { handlesIn, type Value } from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { LogRecord, SpawnOptions } from '../../instance-state.ts';
import type { ActiveFrame, FrameEntry, FrameHeap } from '../../interpreter/frames.ts';
import { newFrame, releaseFrame } from '../../interpreter/machine.ts';
import type { Passed } from '../../interpreter/registers.ts';
import { type Decision, releaseLosers, resume } from '../../interpreter/suspension.ts';
import { isDisposable } from '../../lifetimes/disposal.ts';
import { heldFrom } from '../../lifetimes/holders.ts';
import { type HoldingFrame, heldObjects, isRoot, keptFrame } from '../../snapshot/holdings.ts';
import { type HeapObject, isReference } from '../../snapshot/objects.ts';
import { drawOf, seedFrom } from '../../snapshot/random.ts';
import type { InstanceCall, Snapshot } from '../../snapshot/snapshot.ts';
import type { LoadedDefinition } from '../loaded-definition.ts';
import { reachingMock } from '../testing/mocks.ts';
import { ContextConstants } from './context-constants.ts';
import { leaving } from './crossing.ts';
import { DisposalNotices } from './disposal-notices.ts';
import { type Answered, Futures } from './futures.ts';
import { Heap, type LiveExecution, type LiveObject, type LiveObjectOf } from './heap.ts';
import { spawnedName } from './instance-names.ts';
import { liveObject, storedObject } from './live-objects.ts';
import { ReadyQueue, type ReadyToRun } from './ready.ts';
import { Slots } from './slots.ts';
import { Waits } from './waits.ts';
import { WeakSide } from './weak-side.ts';

/**
 * A call this segment spawned (§9): the new instance's name, what it calls, its own options, the
 * seed of its random source, drawn from this instance's, and its outcome's encoder.
 */
export interface Spawn extends Required<SpawnOptions> {
  readonly name: string;
  readonly call: InstanceCall;
  readonly seed: string;
  readonly encoder: FunctionId | undefined;
}

export type InstanceStatus = Snapshot['status'];

export class Instance {
  readonly loaded: LoadedDefinition;
  readonly heap: Heap;
  readonly waits: Waits;
  readonly futures: Futures;
  readonly slots: Slots;
  readonly weak: WeakSide;
  readonly notices: DisposalNotices;
  /** The heap as its frames reach it (interpreter/machine.ts). */
  readonly frameHeap: FrameHeap = {
    read: (cell) => this.heap.of(cell, 'cell').value,
    write: (cell, value) => {
      this.heap.replace({ ...this.heap.of(cell, 'cell'), value });
    },
    create: (type, value) => this.heap.add((id) => ({ kind: 'cell', id, type, value })).id,
    contextConstant: (name) => this.#constants.read(name),
    makeContextConstant: (name, value) => {
      this.#constants.make(name, value);
    },
    released: (contents) => {
      if (!isReference(contents)) {
        this.heap.noteReleased(handlesIn(contents));
      }
    },
  };
  /**
   * The snapshot this instance was made from, or last committed, which its next commit changes only
   * where it ran.
   */
  #from: Snapshot;
  #spawns: Spawn[] = [];
  #answered: Answered[] = [];
  #logs: LogRecord[] = [];
  /** How many random draws this segment made. */
  #draws = 0;
  readonly #constants: ContextConstants;
  readonly #ready: ReadyQueue;
  /** The extern constants read before this segment, and those it read itself (§3.6). */
  readonly #pinned: Map<string, Value>;

  private constructor(loaded: LoadedDefinition, snapshot: Snapshot) {
    this.loaded = loaded;
    this.#from = snapshot;
    this.#pinned = new Map(snapshot.pinned.map(({ key, value }) => [key, value]));
    this.heap = new Heap(
      snapshot.objects.map((object) => liveObject(loaded.definition, object, this.frameHeap)),
    );
    this.#constants = new ContextConstants(this.heap);
    this.notices = new DisposalNotices(this.heap);
    this.#ready = new ReadyQueue(this.heap, snapshot.ready);
    this.waits = new Waits(this.heap, {
      decided: (waiter, { position }) => {
        if (releaseLosers(topFrame(waiter), position)) {
          this.heap.noteLosersReleased();
        }
        this.#ready.waiter(waiter);
      },
      watchesCall: (waiter, future) => this.weak.watchesCall(waiter, future),
      called: (callback, argumentValues) => {
        this.#ready.run(callback, argumentValues);
      },
    });
    this.futures = new Futures(this.heap, this.waits, this.notices, (answered) => {
      this.#answered.push({ ...answered, value: leaving(this, answered.value) });
    });
    this.slots = new Slots(this.heap, this.futures);
    this.weak = new WeakSide(this.heap, this.futures);
  }

  /**
   * The instance an `unstarted` snapshot describes: its root execution about to run the snapshot's
   * call from its start, or, for a call of an extern, none, the first segment making the call
   * (../segment/root-outcome.ts).
   */
  static start(loaded: LoadedDefinition, snapshot: Snapshot): Instance {
    if (snapshot.status.kind !== 'unstarted') {
      unreachable(`Instance '${snapshot.instance}' has started already.`);
    }
    const { call } = snapshot.status;
    const instance = new Instance(loaded, snapshot);
    const callee = loaded.functions.callee(call.function);
    if (callee.kind === 'code') {
      instance.startExecution(callee, call.arguments, call.captures);
    }
    return instance;
  }

  /** The instance a committed snapshot describes. */
  static restore(loaded: LoadedDefinition, snapshot: Snapshot): Instance {
    return new Instance(loaded, snapshot);
  }

  /**
   * What a commit would persist, in one walk: the executions and what they hold, in id order, and
   * how deep the deepest value among them nests (§5).
   */
  persisted(): Persisted {
    const { kept, depth } = this.#kept();
    return { objects: kept.map(storedObject), depth };
  }

  /**
   * Lets go of what nothing holds any more, as a commit leaves it out (§5): a live run's, which
   * never commits, so a timer no one waits on no longer wakes it.
   */
  dropUnheld(): void {
    this.heap.keepOnly(new Set(this.#kept().kept.map(({ id }) => id)));
    this.notices.forgetGone();
  }

  /**
   * What a commit keeps, in id order: the executions and what they hold, and how deep the deepest
   * value among them nests. Whatever was disposable was disposed where it lost its last holder.
   */
  #kept(): { readonly kept: readonly LiveObject[]; readonly depth: number } {
    const executions = this.heap.objectsOf('execution');
    const held = heldFrom(this.heap, {
      frames: [...executions.flatMap((execution) => execution.frames), ...this.keptFrames()],
      objects: this.owed(),
    });
    const lost = this.heap
      .objects()
      .find(
        (object) =>
          !held.objects.has(object.id) &&
          isDisposable({ heap: this.heap, types: this.loaded.definition.types }, object),
      );
    if (lost !== undefined) {
      unreachable(`Object ${lost.id} lost its last holder without being disposed.`);
    }
    const kept = this.heap
      .objects()
      .filter((object) => isRoot(object) || held.objects.has(object.id));
    return { kept, depth: held.depth };
  }

  /**
   * The instance as a snapshot with `status`, holding `objects`, what `persisted` found: the
   * snapshot it was made from, with what its segment changed.
   */
  snapshot(
    status: Exclude<InstanceStatus, { kind: 'panicked' | 'unstarted' }>,
    objects: readonly HeapObject[],
  ): Snapshot {
    const active = status.kind === 'active';
    return {
      ...this.#from,
      status,
      spawned: this.#from.spawned + this.#spawns.length,
      random: { ...this.#from.random, draws: this.#from.random.draws + this.#draws },
      pinned: [...this.#pinned].map(([key, value]) => ({ key, value })),
      objects: active ? [...objects] : [],
      ready: active ? [...this.#ready.ids] : [],
    };
  }

  /**
   * Runs on from `committed`, the snapshot this instance just committed, as an instance restored
   * from it would (§5): what the commit left out is gone, and what its segment spawned, answered,
   * logged and drew was committed with it.
   */
  continueFrom(committed: Snapshot): void {
    this.heap.keepOnly(new Set(committed.objects.map(({ id }) => id)));
    this.#from = committed;
    this.#spawns = [];
    this.#answered = [];
    this.#logs = [];
    this.#draws = 0;
  }

  /** The instance's name, as its host gave it or as its parent's spawn made it (§9). */
  get name(): string {
    return this.#from.instance;
  }

  /** Whether every segment runs twice before it commits (§10). */
  get crashEveryAwait(): boolean {
    return this.#from.crashEveryAwait;
  }

  /** Whether a panic terminates the instance at once (§9). */
  get terminatesOnPanic(): boolean {
    return this.#from.terminatesOnPanic;
  }

  /** The entry encoding the instance's outcome for its host (§9); undefined when none writes it. */
  get encoder(): FunctionId | undefined {
    return this.#from.encoder;
  }

  /**
   * What the extern constant `key` gives this instance: what `read` gives the first time any of
   * its segments reads it, and that same value ever after (§3.6).
   */
  pinned(key: string, read: () => Value): Value {
    const known = this.#pinned.get(key);
    if (known !== undefined) {
      return known;
    }
    const value = read();
    this.#pinned.set(key, value);
    return value;
  }

  /** The calls this segment spawned, each a new instance once the segment commits (§9). */
  spawns(): readonly Spawn[] {
    return this.#spawns;
  }

  /** How many instances this one spawned before its current segment, which numbers the next. */
  get spawnedBefore(): number {
    return this.#from.spawned;
  }

  /**
   * Records `call` as spawned by this segment, with `options`, and with `crashEveryAwait` too when
   * this instance runs with it (§9, §10), its outcome encoded by `encoder`; the name the new
   * instance will have.
   */
  spawn(call: InstanceCall, options: SpawnOptions, encoder: FunctionId | undefined): string {
    const name = spawnedName(this.name, this.spawnedBefore + this.#spawns.length + 1);
    this.#spawns.push({
      name,
      call,
      crashEveryAwait: this.crashEveryAwait || options.crashEveryAwait === true,
      terminatesOnPanic: options.terminatesOnPanic === true,
      encoder,
      seed: seedFrom(this.draw()),
    });
    return name;
  }

  /** The next draw from this instance's random source (§3.8 `random`). */
  draw(): Uint8Array {
    const { seed, draws } = this.#from.random;
    const index = draws + this.#draws;
    this.#draws += 1;
    return drawOf(seed, index);
  }

  /** Records `record`, which reaches the host once this segment commits (§3.8 `log`). */
  log(record: LogRecord): void {
    this.#logs.push(record);
  }

  /** The log records this segment wrote, in order. */
  logs(): readonly LogRecord[] {
    return this.#logs;
  }

  /**
   * What the instance's roots other than executions and runs hold: the futures the answers still to
   * give other instances' calls wait on (§10), and its outcome, once its root gave a future (§9).
   */
  owed(): readonly number[] {
    return [...this.heap.objectsOf('answer'), ...this.heap.objectsOf('outcome')].flatMap(
      heldObjects,
    );
  }

  /**
   * The roots keeping values for later, as frames: the runs ready to start, holding what they call
   * with, and the context constants made, holding their values.
   */
  keptFrames(): readonly HoldingFrame[] {
    return [...this.heap.objectsOf('run'), ...this.heap.objectsOf('contextConstant')].map(
      keptFrame,
    );
  }

  /** The answers this segment gave other instances' calls, each filled once it commits (§10). */
  answered(): readonly Answered[] {
    return this.#answered;
  }

  /** The mock this instance holds for `target`: the newest, the one a call reaches (§10). */
  mockOf(target: FunctionId): LiveObjectOf<'mock'> | undefined {
    return reachingMock(this.heap.find('mocks', target));
  }

  /**
   * A new execution about to run function `entry` with `contents` in its parameters, those a call
   * left out empty, and a closure's `captures` after them; an async call's execution `resolves` its
   * future on return.
   */
  startExecution(
    entry: FrameEntry,
    contents: readonly Passed[],
    captures: readonly Value[] = [],
    resolves?: number,
  ): LiveExecution {
    const frame = newFrame(entry, contents, this.frameHeap, captures);
    return this.heap.add((id) => ({
      kind: 'execution',
      id,
      resolves,
      frames: [frame],
      disposing: false,
    }));
  }

  /** Whether nothing is ready to run. */
  get idle(): boolean {
    return this.#ready.idle;
  }

  /** What runs next (ready.ts): a waiter moved past its wait, or a run whose call to make. */
  resumeNext(): ReadyToRun | undefined {
    return this.#ready.next(this.waits);
  }

  /** The root execution, which resolves no call future; undefined once it has returned. */
  root(): LiveExecution | undefined {
    const [root] = this.heap.find('executions', undefined);
    return root;
  }

  /** The future the instance awaits as its outcome, once its root returned it pending (§9). */
  awaitedOutcome(): number | undefined {
    const [awaited] = this.heap.objectsOf('outcome');
    return awaited?.future;
  }

  /** Makes `future`, which its root returned pending, the outcome the instance awaits (§9). */
  awaitOutcome(future: number): void {
    this.heap.add((id) => ({ kind: 'outcome', id, future }));
  }

  /**
   * Lets go of the instance's root, as it finishes or ends (§9, §3.12): stops its root execution,
   * or lets go of the outcome it awaits. Every root is let go of here, so what it held is noted
   * released and collected as any release is: the call an awaited outcome holds is disposed, its
   * cleanup running, unless it returned (§7).
   */
  releaseRoot(): void {
    this.dropRuns();
    const root = this.root();
    if (root !== undefined) {
      this.stop(root);
    }
    for (const awaited of this.heap.objectsOf('outcome')) {
      this.heap.remove(awaited.id);
    }
  }

  /**
   * Lets go of the answers the instance owes calls made into it from outside, as it ends (§3.12):
   * their callers heard of its panic, so the calls answering them are disposed, as any let go of.
   */
  releaseAnswers(): void {
    for (const answer of this.heap.objectsOf('answer')) {
      this.heap.remove(answer.id);
    }
  }

  /**
   * Drops the runs ready and readies none from now on, as the instance finishes or ends (§9,
   * §3.12): nothing runs after, so what they would have called with is let go of (ready.ts).
   */
  dropRuns(): void {
    this.#ready.close();
  }

  /**
   * Lets go of the instance's context constants as it finishes or ends, last of all (§3.4), with
   * `collect` disposing what each held (context-constants.ts).
   */
  releaseConstants(collect: () => void): void {
    this.#constants.release(collect);
  }

  /** Removes an execution whose call returned. */
  remove(execution: LiveExecution): void {
    this.heap.remove(execution.id);
    this.weak.onReturned(execution.id);
  }

  /**
   * Stops `execution` where it waits (§7: its call was disposed), letting go of everything its
   * frames hold, innermost first.
   */
  stop(execution: LiveExecution): void {
    this.#endWait(execution);
    for (const frame of execution.frames.toReversed()) {
      releaseFrame(frame);
    }
    this.heap.remove(execution.id);
  }

  /**
   * Resumes `execution` as `decision` says, whatever its wait was decided at: a disposed call
   * resuming on its `disposing()` watch, the case that wins over any other (§7).
   */
  resumeOn(execution: LiveExecution, decision: Decision): void {
    this.#endWait(execution);
    resume(topFrame(execution), decision);
  }

  /** Ends `execution`'s wait, if it waits: the wait goes, and it is no longer ready. */
  #endWait(execution: LiveExecution): void {
    this.waits.end(execution);
    this.#ready.withdraw(execution);
  }
}

/** What a commit persists of a running instance (`Instance.persisted`). */
export interface Persisted {
  readonly objects: readonly HeapObject[];
  readonly depth: number;
}

/** The innermost frame of `execution`, which always has one. */
export function topFrame(execution: LiveExecution): ActiveFrame {
  const frame = execution.frames.at(-1);
  if (frame === undefined) {
    unreachable(`Execution ${execution.id} has no frame.`);
  }
  return frame;
}
