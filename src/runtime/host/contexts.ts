/**
 * The contexts one live run reaches (§9, ../scheduler/run-contexts.ts), as the runtime that started
 * it runs them: instances in its store, named by key, held and advanced as every instance of the
 * runtime is, one host call at a time each (instance-calls.ts).
 *
 * - Opening a runtime while none is open resumes the work persisted in the store: every instance
 *   that hasn't ended joins the group the run drives (instance-group.ts), to advance once and be
 *   woken as its timers come due. So no host resumes an instance by name. With no runtime open,
 *   the group stays as it is.
 * - A call into a context is an invocation (../scheduler/wake.ts): it advances the context, made
 *   with the options of the run's start when the store has none by its key, from its last commit,
 *   starting the call. Its answer goes to the call's listener, the value it gave; a context that
 *   panics ends every call into it still waiting, as does calling one that had ended or panicked.
 * - Each call is named by a token unique to the process, so an answer the store kept from an
 *   earlier process, whose caller is gone, reaches nobody.
 * - Calls run first, then what the group can run: a context or instance the run made ready, or one
 *   waiting on the end of one that has ended. A call made starts even once its runtime is disposed,
 *   or the run has ended: releasing it cancels nothing, and only its invocation's later work waits
 *   for the next open.
 */

import { randomUUID } from 'node:crypto';
import { storedSnapshot } from '../scheduler/instance/instance-ends.ts';
import type { LoadedDefinition } from '../scheduler/loaded-definition.ts';
import { Resident } from '../scheduler/resident.ts';
import type { ContextCall, RunContexts } from '../scheduler/run-contexts.ts';
import { type Advance, type AdvanceFirst, type Beginning, newContext } from '../scheduler/wake.ts';
import type { InstanceCall } from '../snapshot/snapshot.ts';
import type { InstanceStore } from '../store.ts';
import type { InstanceCalls } from './instance-calls.ts';
import { InstanceGroup } from './instance-group.ts';
import type { HostFills, HostReports } from './programs.ts';

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
  /** Whether the host may still fill a future it named, and when that may change. */
  readonly fills: HostFills;
  /** Told what each of its own advances reports, as no host call returns it. */
  readonly reports: HostReports;
}

/**
 * Shown each advance of a runtime's instances, by whatever made it, and with none each host call
 * that may have changed what can wake one, a fill refused included.
 */
export type InstanceObserver = (instance: string, advanced: Advance | undefined) => void;

/** A call waiting for its answer: the context it went to, its live future and its listener. */
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
  readonly #open = new Set<number>();
  #opened = 0;
  /** The instances whose advance it makes now, so one of them shown meanwhile is its own. */
  readonly #advancing = new Set<string>();
  #poke: (() => void) | undefined;
  readonly #unobserve: () => void;

  constructor(seams: ContextSeams<Program>) {
    this.#seams = seams;
    this.#unobserve = seams.observe((instance, advanced) => {
      if (!(this.#group.states.has(instance) || this.#awaitsAnswerFrom(instance))) {
        return;
      }
      const own = this.#advancing.has(instance);
      if (advanced !== undefined) {
        this.#record(instance, advanced, own);
      }
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
  }

  fillsChanged(): Promise<void> {
    return this.#seams.fills.changed();
  }

  awaitsHost(): boolean {
    return (
      this.#seams.fills.may() &&
      [...this.#group.states.keys()].some((instance) => {
        const objects = this.#seams.residentOf(instance)?.committed.objects ?? [];
        return objects.some((object) => object.kind === 'future' && object.state.kind === 'host');
      })
    );
  }

  open(): number {
    if (this.#open.size === 0) {
      this.#resume();
    }
    this.#opened += 1;
    this.#open.add(this.#opened);
    return this.#opened;
  }

  call(runtime: number, { key, call, future, listener }: ContextCall): void {
    if (!this.#open.has(runtime)) {
      listener.panicked({ message: 'The runtime was disposed before the call.', trace: '' });
      return;
    }
    const token = randomUUID();
    this.#waiting.set(token, { key, future, listener });
    this.#pending.push({ key, call, token });
  }

  dispose(runtime: number): void {
    this.#open.delete(runtime);
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

  awaitsCall(future: number): boolean {
    return [...this.#waiting.values()].some((waiting) => waiting.future === future);
  }

  /** Has every instance of the store that hasn't ended join the group, to advance once. */
  #resume(): void {
    for (const instance of this.#seams.store.instances()) {
      const status = storedSnapshot(this.#seams.store, instance)?.status.kind;
      if (status === 'active' || status === 'unstarted') {
        this.#group.record(instance, { state: { kind: 'ready' }, spawned: [], logs: [] });
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
   * Records where `instance` stands after `advanced`, delivering its answers and its panic, which
   * the host hears of, its own advance's, when no call waits to.
   */
  #record(instance: string, advanced: Advance, own: boolean): void {
    this.#group.record(instance, advanced);
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
    if (state.kind !== 'panicked' && state.kind !== 'terminated') {
      return;
    }
    const heard = [...this.#waiting].filter(([, waiting]) => waiting.key === instance);
    for (const [token] of heard) {
      this.#end(token, state);
    }
    if (own && heard.length === 0 && state.kind === 'panicked') {
      this.#seams.reports.panicked(instance, state);
    }
  }

  /** Ends the call named `token` with `panic`, before it gave anything. */
  #end(token: string, panic: { readonly message: string; readonly trace: string }): void {
    const waiting = this.#waiting.get(token);
    this.#waiting.delete(token);
    waiting?.listener.panicked(panic);
  }
}

/** Why a call into the context `key` whose last commit is `status`, not active, gives nothing. */
function endedMessage(
  key: string,
  status: Exclude<Resident['committed']['status'], { kind: 'active' }>,
): { readonly message: string; readonly trace: string } {
  return status.kind === 'panicked' || status.kind === 'terminated'
    ? { message: status.message, trace: status.trace }
    : { message: `The context '${key}' has ended.`, trace: '' };
}
