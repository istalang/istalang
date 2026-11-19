/**
 * Async calls (ir-first design, decision 3): each runs on its frame record as an execution of its
 * own, started at once. It runs until it parks or returns, and its caller gets its future, which
 * its return settles.
 *
 * - **Parking.** A wait decided readies the execution to resume with its decision (ready-queue.ts);
 *   one decided anew as its call is disposed (`disposingWins`) resumes where it was readied first.
 * - **Stopping** (§16): an execution whose future is disposed settles its `disposing()`. Where that
 *   unparks it, it resumes at once on that case, before anything else; else it resumes with `STOP`,
 *   which sends it to its stop landing, letting go of what its frame holds. Either way, the next
 *   `park` it reaches stops it.
 * - **Commits** are each await's (§15.2): an execution parking marks the instance's segment as one
 *   to commit, and the one parking last names the await a failed commit panics at.
 * - **The call rule** (foundation/language/call-rule.ts): an instance starts async code of its own
 *   kind alone. The IR's function types carry no mark, so only the run sees which kind a call
 *   starts; a start of the other kind is a lowering bug.
 */

import type { CodeFunction } from '../../definition/tables/functions.ts';
import type { Definition } from '../../definition/tables/index.ts';
import type { Value } from '../../definition/values/values.ts';
import { mayCall } from '../../foundation/language/call-rule.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { Instance } from './instances.ts';
import type { Lifetimes } from './lifetimes.ts';
import { Execution, type Frame } from './objects/execution.ts';
import { Future, watchFuture } from './objects/future.ts';
import type { ReadyQueue } from './ready-queue.ts';
import type { TransientScope } from './transient-scope.ts';

/** What a parked frame's resumable function returns. */
export const PARKED = Symbol('parked');
/** What a stopped frame's resumable function returns. */
export const STOPPED = Symbol('stopped');
/** The decision a stopped frame resumes with, which sends it to its stop landing. */
export const STOP = Symbol('stop');

/** What executions need of their run. */
interface ExecutionSeams {
  readonly definition: Definition;
  readonly instance: Instance;
  readonly lifetimes: Lifetimes;
  readonly queue: ReadyQueue;
  /** The compiled entries, by function index. */
  readonly entry: (index: number) => (frame: Frame) => unknown;
  readonly newId: () => number;
  readonly settle: (future: Future, value: Value) => void;
  /** The transients' scope of an execution starting now, holding the cells visible here (§7.1). */
  readonly startedTransients: () => TransientScope;
  /** What `run` gives; a panic in a durable instance ends the instance, and gives nothing. */
  readonly guarded: <Result>(run: () => Result) => Result | undefined;
}

export class Executions {
  readonly #seams: ExecutionSeams;
  /** The executions started and not yet ended. */
  readonly #live = new Set<Execution>();
  #running: Execution | undefined;
  /** The execution whose call is being disposed now, its `disposing()` future settling. */
  #disposingNow: Execution | undefined;
  /** Whether an execution parked since the instance last committed: each await commits (§15.2). */
  parkedSinceCommit: boolean;
  /** The execution that parked last, whose await a commit that fails names. */
  lastParked: Execution | undefined;

  constructor(seams: ExecutionSeams) {
    this.#seams = seams;
    this.parkedSinceCommit = false;
  }

  /** The execution whose code runs now, as simple code nested in it reads its call (§16). */
  readonly current = (): Execution | undefined => this.#running;

  /**
   * Starts async entry `index` with `passed`: runs it until it parks or returns; its future. Its
   * frame outlives the caller's step, so it holds what it was given, and the transients' cells
   * visible here, until it ends.
   */
  start(index: number, passed: readonly Value[], closure: Value | undefined): Future {
    const { definition, instance, lifetimes, newId, startedTransients } = this.#seams;
    const entry = definition.functions[index] as CodeFunction;
    if (!mayCall(instance.kind, entry.mode)) {
      unreachable(
        `A ${instance.kind} instance starts ${entry.mode} code, which the call rule refuses.`,
      );
    }
    const execution = new Execution(newId(), newId(), instance);
    passed.forEach((value, at) => {
      const type = entry.registers[at]?.type;
      if (type !== undefined) {
        lifetimes.keep(value, type);
      }
    });
    lifetimes.hold(closure);
    execution.given = [...passed, closure ?? null];
    execution.transients = startedTransients();
    this.#live.add(execution);
    const registers: (Value | undefined)[] = Array.from({ length: entry.registers.length });
    passed.forEach((value, at) => {
      registers[at] = value;
    });
    const captures = (closure as { readonly captures?: readonly Value[] } | undefined)?.captures;
    captures?.forEach((value, at) => {
      registers[entry.parameters.length + at] = value;
    });
    execution.frame = {
      function: index,
      parkedAt: undefined,
      registers,
      closure,
      decision: undefined,
      execution,
      stopping: false,
    };
    const { future } = execution;
    future.count = 1;
    this.resume(execution, undefined);
    return future;
  }

  /** Runs `execution` from where it parked, with `decision`, until it parks or ends. */
  resume(execution: Execution, decision: unknown): void {
    const { instance, lifetimes, entry, guarded, settle } = this.#seams;
    if (execution.ended || instance.end !== undefined) {
      return;
    }
    const outer = this.#running;
    this.#running = execution;
    const { frame } = execution;
    frame.decision = decision as Value;
    execution.parked = false;
    try {
      const result = guarded(() => entry(frame.function)(frame));
      if (result === PARKED) {
        execution.parked = true;
        this.parkedSinceCommit = true;
        this.lastParked = execution;
        return;
      }
      execution.ended = true;
      this.#live.delete(execution);
      lifetimes.letGo(...execution.given, ...execution.transients.held());
      // A call stopping as it is disposed returns into no future (its `return` lets go of what it
      // gives with the rest).
      if (result !== STOPPED && result !== undefined) {
        settle(execution.future, result as Value);
      }
    } finally {
      this.#running = outer;
    }
  }

  /**
   * What `run` gives, run as a call of its own: code the run calls outside every execution (a
   * readied callback, another instance's mock answered here) still has a call, which a wait it
   * makes names (`currentCall`), though it never parks. Its panic ends an ista instance.
   */
  asCall<Result>(run: () => Result): Result | undefined {
    const { instance, newId, guarded } = this.#seams;
    const outer = this.#running;
    this.#running = new Execution(newId(), newId(), instance);
    try {
      return guarded(run);
    } finally {
      this.#running = outer;
    }
  }

  /**
   * Readies `execution` to resume with `decision`, the position its wait was decided for; an ended
   * call, stopped while what it waited on lives on into the round after, resumes no more.
   */
  unpark(execution: Execution, decision: Value): void {
    if (execution.ended) {
      return;
    }
    if (this.#disposingNow === execution) {
      execution.decidedDisposing = decision;
    }
    this.#seams.queue.resume(execution, decision);
  }

  /** Whether `execution`'s call is being disposed, its `disposing()` future settling (§16). */
  disposingWins(execution: Execution): boolean {
    return this.#disposingNow === execution;
  }

  /** The future `execution`'s `disposing()` gives (§16): settled once its call is disposed. */
  disposingOf(execution: Execution): Future {
    execution.disposing = watchFuture(execution.disposing, () => new Future(this.#seams.newId()));
    if (execution.frame.stopping && !execution.disposing.settled) {
      this.#seams.settle(execution.disposing, null);
    }
    return execution.disposing;
  }

  /**
   * Stops `execution`, whose future was disposed (§16). Resuming on its `disposing()`, it runs
   * cleanup code, whose let-gos are disposed in rounds of their own before its call is gone;
   * stopped where it waits, it runs none, so what its frame held loses its holder with the rest of
   * its disposal, in the round after.
   */
  stop(execution: Execution): void {
    if (execution.ended) {
      return;
    }
    const { lifetimes, queue, settle } = this.#seams;
    execution.frame.stopping = true;
    lifetimes.apart(() => {
      if (execution.disposing !== undefined) {
        const outer = this.#disposingNow;
        this.#disposingNow = execution;
        try {
          settle(execution.disposing, null);
        } finally {
          this.#disposingNow = outer;
        }
      }
      if (execution.parked && execution.decidedDisposing !== undefined) {
        queue.unready(execution);
        this.resume(execution, execution.decidedDisposing);
      }
    });
    if (execution.parked) {
      queue.unready(execution);
      this.resume(execution, STOP);
    }
  }

  /** Stops every call still suspended, newest first, as the run finishes. */
  stopAll(): void {
    const suspended = [...this.#live].sort((first, second) => second.object - first.object);
    for (const execution of suspended) {
      this.stop(execution);
    }
  }

  /** The executions started and not yet ended, as a snapshot keeps them. */
  get live(): readonly Execution[] {
    return [...this.#live];
  }

  /** Keeps going the executions a snapshot read back kept. */
  restore(live: readonly Execution[]): void {
    for (const execution of live) {
      this.#live.add(execution);
    }
  }
}
