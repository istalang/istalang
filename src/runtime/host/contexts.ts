/**
 * The contexts one live run reaches (§9, ../scheduler/run-contexts.ts), as the runtime that started
 * it runs them: instances in its store, named by key, held and advanced as every instance of the
 * runtime is, one host call at a time each (instance-calls.ts).
 *
 * - Opening a runtime while none is open resumes the work persisted in the store: every instance
 *   that hasn't ended joins the group the run drives (instance-group.ts), to advance once and be
 *   woken as its timers come due, as does one a host's call makes run again while one is open, a
 *   retry. So no host resumes an instance by name. With no runtime open, the group stays as it is.
 * - A call into a context is an invocation (../scheduler/wake.ts): it advances the context, made
 *   with the options of the run's start when the store has none by its key, from its last commit,
 *   starting the call. Its answer goes to the call's listener, the value it gave; a context that
 *   panics ends every call into it still waiting, as does calling one that had ended or panicked,
 *   and the host hears of the panic unless a call of the program's was among them: one let go of
 *   waits no more, and the calls the loop serving jobs makes hear none (`CallMaker`).
 * - Each call is named by a token unique to the process, so an answer the store kept from an
 *   earlier process, whose caller is gone, reaches nobody.
 * - Calls run first, then what the group can run: a context or instance the run made ready, or one
 *   waiting on the end of one that has ended.
 * - The earliest runtime still open serves the jobs of every instance of the group running the
 *   run's own program (`served`), so one serves each at a time, and one opened later takes them
 *   over once those before it are disposed. A panic ends the loop serving an instance, so a retry
 *   names it again, for a loop of its own. An instance on another program waits for a run of its
 *   own: the loop serving it calls functions of its program (§5, versioning). A call made starts even once its runtime is disposed,
 *   or the run has ended: releasing it cancels nothing, and only its invocation's later work waits
 *   for the next open.
 */

import { randomUUID } from 'node:crypto';
import { memo } from '../../foundation/structures/memo.ts';
import type { InstanceState } from '../instance-state.ts';
import { storedSnapshot } from '../scheduler/instance/instance-ends.ts';
import type { LoadedDefinition } from '../scheduler/loaded-definition.ts';
import { Resident } from '../scheduler/resident.ts';
import type { ContextCall, RunContexts, ServedWait } from '../scheduler/run-contexts.ts';
import { type Advance, type AdvanceFirst, type Beginning, newContext } from '../scheduler/wake.ts';
import type { InstanceCall } from '../snapshot/snapshot.ts';
import type { InstanceStore } from '../store.ts';
import type { InstanceCalls } from './instance-calls.ts';
import { InstanceGroup } from './instance-group.ts';
import type { HostReports } from './programs.ts';

/** What a run's contexts need of the runtime running them. */
export interface ContextSeams<Program extends LoadedDefinition> {
  readonly store: InstanceStore;
  /** What a new context runs: the run's own program. */
  readonly program: Program;
  /** The options and seed a new context begins with: the run's start's. */
  readonly beginning: () => Beginning;
  /** The instance `instance` as the runtime holds it, or reads it from the store; none for none. */
  readonly residentOf: (instance: string) => Resident<Program> | undefined;
  /**
   * Advances `resident` as the runtime advances every instance, starting with `first`, showing the
   * advance to every observer.
   */
  readonly advance: (resident: Resident<Program>, first?: AdvanceFirst) => Advance;
  /** Has `observer` shown every advance of the runtime's instances, until the call it gives. */
  readonly observe: (observer: InstanceObserver) => () => void;
  readonly calls: InstanceCalls;
  /** Told what each of its own advances reports, as no host call returns it. */
  readonly reports: HostReports;
}

/** Shown each advance of a runtime's instances, by whatever made it. */
export type InstanceObserver = (instance: string, advanced: Advance) => void;

/** A call waiting for its answer: the context it went to, its live future, listener and maker. */
type WaitingCall = Omit<ContextCall, 'call'>;

/** A call to make into the context `key`, named by `token`. */
interface PendingCall {
  readonly key: string;
  readonly call: InstanceCall;
  readonly token: string;
}

export class Contexts<Program extends LoadedDefinition> implements RunContexts {
  readonly #seams: ContextSeams<Program>;
  readonly #group = new InstanceGroup();
  readonly #pending: PendingCall[] = [];
  readonly #waiting = new Map<string, WaitingCall>();
  readonly #served = new Set<ServedWait>();
  /**
   * The instances of the run's own program whose jobs to serve, in the order each began to run in
   * the group: as it joined, and again each time it was retried after a panic, which ended the
   * loop serving it, so it gets one of its own again.
   */
  readonly #servedLives: string[] = [];
  /** Whether each instance runs the run's own program, which it does for its whole life. */
  readonly #runsOwnProgram = new Map<string, boolean>();
  readonly #open = new Set<number>();
  #opened = 0;
  /** The instances whose advance it makes now, so one of them shown meanwhile is its own. */
  readonly #advancing = new Set<string>();
  #poke: (() => void) | undefined;
  readonly #unobserve: () => void;

  constructor(seams: ContextSeams<Program>) {
    this.#seams = seams;
    this.#unobserve = seams.observe((instance, advanced) => {
      const joins = this.#open.size > 0 && runs(advanced.state);
      if (!(joins || this.#group.states.has(instance) || this.#awaitsAnswerFrom(instance))) {
        return;
      }
      const own = this.#advancing.has(instance);
      this.#record(instance, advanced, own);
      this.#serve();
      if (!own) {
        this.#poke?.();
      }
    });
  }

  runOn(poke: () => void): void {
    this.#poke = poke;
  }

  close(): void {
    this.#unobserve();
    this.#open.clear();
    this.#served.clear();
  }

  open(): number {
    if (this.#open.size === 0) {
      this.#resume();
    }
    this.#opened += 1;
    this.#open.add(this.#opened);
    this.#serve();
    return this.#opened;
  }

  call(runtime: number, { key, call, future, listener, maker }: ContextCall): void {
    if (!this.#open.has(runtime)) {
      listener.panicked({ message: 'The runtime was disposed before the call.', trace: '' });
      return;
    }
    const token = randomUUID();
    this.#waiting.set(token, { key, future, listener, maker });
    this.#pending.push({ key, call, token });
  }

  served(wait: ServedWait): void {
    this.#served.add(wait);
    this.#serve();
  }

  release(future: number): void {
    for (const [token, waiting] of this.#waiting) {
      if (waiting.future === future) {
        this.#waiting.delete(token);
      }
    }
    for (const wait of this.#served) {
      if (wait.future === future) {
        this.#served.delete(wait);
      }
    }
  }

  dispose(runtime: number): void {
    this.#open.delete(runtime);
    for (const wait of this.#served) {
      if (wait.runtime === runtime) {
        this.#served.delete(wait);
      }
    }
    this.#serve();
  }

  async runReady(): Promise<boolean> {
    let ran = false;
    for (let step = this.#nextStep(); step !== undefined; step = this.#nextStep()) {
      // biome-ignore lint/performance/noAwaitInLoops: one advance at a time, each seeing the last's commit.
      await step();
      ran = true;
    }
    return ran;
  }

  async startCalls(): Promise<void> {
    for (let call = this.#pending.shift(); call !== undefined; call = this.#pending.shift()) {
      // biome-ignore lint/performance/noAwaitInLoops: calls start in the order they were made.
      await this.#invoke(call);
    }
  }

  /**
   * What runs next: a call made, which starts whether or not a runtime is still open, else what the
   * group can run while one is.
   */
  #nextStep(): (() => Promise<void>) | undefined {
    const call = this.#pending.shift();
    if (call !== undefined) {
      return () => this.#invoke(call);
    }
    const ready = this.#open.size > 0 ? this.#group.ready() : undefined;
    return ready === undefined ? undefined : () => this.#advance(ready);
  }

  nextTimer(): bigint | undefined {
    return this.#open.size > 0 ? this.#group.earliestTimer() : undefined;
  }

  async wakeDue(now: bigint): Promise<void> {
    for (const instance of this.#group.dueBy(this.#open.size > 0 ? now : undefined)) {
      // biome-ignore lint/performance/noAwaitInLoops: instances advance one at a time.
      await this.#advance(instance);
    }
  }

  awaitsContexts(future: number): boolean {
    return [...this.#waiting.values(), ...this.#served].some(
      (waiting) => waiting.future === future,
    );
  }

  /** Has the waits of the earliest open runtime hear the instances served, once they know fewer. */
  #serve(): void {
    const serving = Math.min(...this.#open);
    const waits = [...this.#served].filter((wait) => wait.runtime === serving);
    if (waits.length === 0) {
      return;
    }
    for (const wait of waits) {
      if (this.#servedLives.length > wait.known) {
        this.#served.delete(wait);
        wait.listener([...this.#servedLives]);
      }
    }
  }

  /** Records that `instance` began to run in the group, to serve when it runs the run's program. */
  #began(instance: string): void {
    const { program } = this.#seams;
    const own = memo(
      this.#runsOwnProgram,
      instance,
      () => this.#seams.residentOf(instance)?.loaded.hash === program.hash,
    );
    if (own) {
      this.#servedLives.push(instance);
    }
  }

  /** Has every instance of the store that hasn't ended join the group, to advance once. */
  #resume(): void {
    for (const instance of this.#seams.store.instances()) {
      const status = storedSnapshot(this.#seams.store, instance)?.status.kind;
      if (status === 'active' || status === 'unstarted') {
        this.#group.record(instance, { state: { kind: 'ready' }, spawned: [], logs: [] });
        this.#began(instance);
      }
    }
  }

  /** Makes `pending`'s call into its context, made new if the store has none by its key. */
  #invoke({ key, call, token }: PendingCall): Promise<void> {
    return this.#seams.calls.run(key, () => {
      const { program } = this.#seams;
      const resident =
        this.#seams.residentOf(key) ??
        new Resident(program, newContext(program, key, this.#seams.beginning()));
      if (resident.committed.status.kind === 'unstarted') {
        this.#ownAdvance(resident);
      }
      const { status } = resident.committed;
      if (status.kind !== 'active') {
        this.#end(token, endedMessage(key, status));
        return;
      }
      this.#ownAdvance(resident, { kind: 'invocation', invocation: { call, token } });
    });
  }

  /** Advances `instance` from its last commit. */
  #advance(instance: string): Promise<void> {
    return this.#seams.calls.run(instance, () => {
      const resident = this.#seams.residentOf(instance);
      if (resident !== undefined) {
        this.#ownAdvance(resident);
      }
    });
  }

  /** Advances `resident`, starting with `first`; the observer records it, as its own. */
  #ownAdvance(resident: Resident<Program>, first?: AdvanceFirst): void {
    const { instance } = resident.committed;
    this.#advancing.add(instance);
    try {
      this.#seams.advance(resident, first);
    } finally {
      this.#advancing.delete(instance);
    }
  }

  /** Whether a call into `instance` waits for its answer. */
  #awaitsAnswerFrom(instance: string): boolean {
    return [...this.#waiting.values()].some((waiting) => waiting.key === instance);
  }

  /**
   * Records where `instance` stands after `advanced`, delivering its answers, and its end to every
   * call still waiting on it; its panic the host hears of, its own advance's, when no call of the
   * program's waits to.
   */
  #record(instance: string, advanced: Advance, own: boolean): void {
    const { states } = this.#group;
    const joined = [instance, ...advanced.spawned].filter((each) => !states.has(each));
    const retried = states.get(instance)?.kind === 'panicked' && runs(advanced.state);
    this.#group.record(instance, advanced);
    for (const each of retried ? [instance, ...joined] : joined) {
      this.#began(each);
    }
    if (own) {
      this.#seams.reports.logs(advanced.logs);
    }
    for (const { instance: caller, token, value } of advanced.answered) {
      const waiting = caller === undefined ? this.#waiting.get(token) : undefined;
      if (waiting !== undefined) {
        this.#waiting.delete(token);
        waiting.listener.answered(value);
      }
    }
    const { state } = advanced;
    if (!(runs(state) || this.#endCallsInto(instance, state)) && own && state.kind === 'panicked') {
      this.#seams.reports.panicked(instance, state);
    }
  }

  /**
   * Ends every call into `instance` still waiting, as it ran no more at `state`; whether a call of
   * the program's heard it.
   */
  #endCallsInto(instance: string, state: Ended): boolean {
    let heard = false;
    for (const [token, waiting] of this.#waiting) {
      if (waiting.key === instance) {
        this.#end(token, endedMessage(instance, state));
        heard ||= waiting.maker === 'program';
      }
    }
    return heard;
  }

  /** Ends the call named `token` with `panic`, before it gave anything. */
  #end(token: string, panic: { readonly message: string; readonly trace: string }): void {
    const waiting = this.#waiting.get(token);
    this.#waiting.delete(token);
    waiting?.listener.panicked(panic);
  }
}

/** Whether an instance standing at `state` still runs: it hasn't ended or panicked. */
function runs(
  state: InstanceState,
): state is Extract<InstanceState, { kind: 'ready' | 'waiting' }> {
  return state.kind === 'ready' || state.kind === 'waiting';
}

/** Where an instance stands once it runs no more, as its last commit or its advance says. */
type Ended =
  | Exclude<Resident['committed']['status'], { kind: 'active' }>
  | Exclude<InstanceState, { kind: 'ready' | 'waiting' }>;

/** Why a call into the context `key`, which runs no more as `status` says, gives nothing. */
function endedMessage(
  key: string,
  status: Ended,
): { readonly message: string; readonly trace: string } {
  return status.kind === 'panicked' || status.kind === 'terminated'
    ? { message: status.message, trace: status.trace }
    : { message: `The context '${key}' has ended.`, trace: '' };
}
