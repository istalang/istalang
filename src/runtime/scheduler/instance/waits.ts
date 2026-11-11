/**
 * A running instance's waits and the language's resolvers (proposal 8, Rule 5): the one way a
 * waiting execution resumes.
 *
 * - A waiter opens a wait, makes a resolver per case and hands each to that case's `onAwait`. A
 *   future's registers it on the future (`register`), and resolving the future resolves it, found
 *   by lookup, so resolving costs what waits on that future, never a walk of every execution. Code
 *   may resolve one itself.
 * - The wait holds its resolvers registered on futures, and each holds its future (holdings.ts):
 *   the registration persists with the waiting frame, so what a cold awaitable started in its
 *   `onAwait` lives as long as the wait.
 * - A wait is decided once, by the first of its resolvers to resolve: the lowest case among those
 *   whose futures resolved together, or had resolved when registered. Deciding cancels the
 *   resolvers pending then, which do nothing after and let go of their futures, and lets go of the
 *   cases they lost (spec §8), so a losing `take` leaves its slot's queue before a later value can
 *   reach it. A resolver on its waiter's own `disposing()` watch stays registered until the waiter
 *   moves on, as a disposal still resumes the call on it (§7), even one registered after the wait
 *   was decided; one registered on anything else then is cancelled. The waiter is ready once it is
 *   stopped at its wait and that is decided.
 * - Waiters that become ready together are readied in creation order, once each (§6).
 * - A resolver resolves once: a second `resolve` panics, a cancelled resolver ignores it, and
 *   `tryResolve` says whether it decided its wait. One made after an earlier case's `onAwait`
 *   decided its wait is cancelled once its waiter stops there, every case known; until then
 *   `resolve` takes its value to no effect, `tryResolve` cancels it, and letting it go panics
 *   (lifetimes/disposal.ts), so an awaitable's misuse is caught however the race went.
 * - Waits and resolvers are heap objects, committed with the frames they resume, so a crash
 *   discards a decision with the segment that made it; a live run's stay in memory.
 */

import { handleTo, type Value } from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { type Decision, stoppedAt, takeWait } from '../../interpreter/suspension.ts';
import { Panic } from '../../natives.ts';
import type { Settled } from './futures.ts';
import { type Heap, handleObject, type LiveExecution, type LiveObjectOf } from './heap.ts';

type Wait = LiveObjectOf<'wait'>;

type Resolver = LiveObjectOf<'resolver'>;

type PendingResolver = Resolver & {
  readonly state: Extract<Resolver['state'], { readonly kind: 'pending' }>;
};

/** What waits reach outside themselves. */
export interface WaitSeams {
  /** `waiter`, stopped at its wait, is to resume as `decision` says. */
  readonly decided: (waiter: LiveExecution, decision: Decision) => void;
  /** Whether `future` is a pending `disposing()` watch on the call `waiter` runs (§7). */
  readonly watchesCall: (waiter: LiveExecution, future: number) => boolean;
}

export class Waits {
  readonly #heap: Heap;
  readonly #seams: WaitSeams;

  constructor(heap: Heap, seams: WaitSeams) {
    this.#heap = heap;
    this.#seams = seams;
  }

  /** A new pending wait of `waiter`; a handle to it. */
  open(waiter: LiveExecution): Value {
    const wait = this.#heap.add(
      (id): Wait => ({ kind: 'wait', id, waiter: waiter.id, state: { kind: 'pending' } }),
    );
    return handleTo(wait.id);
  }

  /** A new pending resolver of the wait `wait` names, for its case `position`; a handle to it. */
  resolver(wait: Value, position: number): Value {
    const decides = this.#heap.of(handleObject(wait), 'wait');
    const resolver = this.#heap.add(
      (id): Resolver => ({
        kind: 'resolver',
        id,
        state: { kind: 'pending', wait: decides.id, position },
      }),
    );
    return handleTo(resolver.id);
  }

  /**
   * Resolves the resolver `done` as the future `future` resolves, a future's `onAwait`: at once with
   * what `settled` says it resolved with, else registered on it; once its wait was decided, only on
   * its waiter's own `disposing()` watch, cancelled otherwise. One resolved already, or registered
   * on a future already, is misused, which panics.
   */
  register(done: Value, future: number, settled: Settled | undefined): void {
    const resolver = this.#resolver(done);
    if (resolver.state.kind === 'resolved') {
      throw new Panic('A resolver was given to wait on a future after it was resolved.');
    }
    if (isPending(resolver) && resolver.state.on !== undefined) {
      throw new Panic('A resolver was given to wait on a second future.');
    }
    if (settled !== undefined) {
      this.resolve(done, settled.value);
      return;
    }
    if (!isPending(resolver)) {
      return;
    }
    const wait = this.#waitOf(resolver);
    if (wait.state.kind !== 'pending' && !this.#keeps(wait, future)) {
      this.#cancel(resolver);
      return;
    }
    this.#heap.replace({ ...resolver, state: { ...resolver.state, on: future } });
  }

  /**
   * Resolves `done` with `value`: nothing once it is cancelled, and a panic once it resolved. One
   * whose wait another case decided after it was made takes the value to no effect, so resolving it
   * again still panics.
   */
  resolve(done: Value, value: Value): void {
    const resolver = this.#resolver(done);
    if (resolver.state.kind === 'resolved') {
      throw new Panic('A resolver was resolved twice.');
    }
    if (isPending(resolver) && !this.#decide(resolver, value)) {
      this.#replace(resolver, { kind: 'resolved' });
    }
  }

  /**
   * Resolves `done` with `value` if that decides its wait; whether it did. One whose wait another
   * case decided is cancelled instead.
   */
  tryResolve(done: Value, value: Value): boolean {
    const resolver = this.#resolver(done);
    if (!isPending(resolver)) {
      return false;
    }
    const took = this.#decide(resolver, value);
    if (!took) {
      this.#cancel(resolver);
    }
    return took;
  }

  /**
   * Decides every wait with a resolver registered on one of `resolved`, futures that resolved
   * together, at its lowest case among them, with what `settled` says that one resolved with; in
   * the order their waiters were created. Every other resolver registered on them is cancelled.
   */
  settle(resolved: ReadonlySet<number>, settled: (future: number) => Settled): void {
    const registered = [...resolved].flatMap((future) =>
      this.#heap.find('resolvers', future).filter(isPending),
    );
    const winners = new Map<number, PendingResolver>();
    for (const resolver of registered) {
      const best = winners.get(resolver.state.wait);
      if (best === undefined || resolver.state.position < best.state.position) {
        winners.set(resolver.state.wait, resolver);
      }
    }
    const inOrder = [...winners.values()].toSorted(
      (first, second) => this.#waitOf(first).waiter - this.#waitOf(second).waiter,
    );
    for (const resolver of inOrder) {
      this.#decide(resolver, settled(registeredOn(resolver)).value);
    }
    for (const resolver of registered) {
      this.#cancel(this.#heap.of(resolver.id, 'resolver'));
    }
  }

  /**
   * Readies `waiter`, which has just stopped at its wait, if that is decided already: decided while
   * its cases' `onAwait`s ran, so the resolvers made after are cancelled now, every case known.
   */
  stopped(waiter: LiveExecution): void {
    const wait = this.#stoppedWait(waiter);
    if (wait?.state.kind === 'decided') {
      this.#ready(waiter, wait, wait.state);
    }
  }

  /**
   * The case of the wait `waiter` is stopped at whose resolver is registered on a `disposing()`
   * watch of its own call, by position: the case a disposal of that call resumes it on (§7).
   */
  cleanupCase(waiter: LiveExecution): number | undefined {
    const wait = this.#stoppedWait(waiter);
    const resolver =
      wait === undefined
        ? undefined
        : this.#pendingCases(wait).find(
            ({ state }) => state.on !== undefined && this.#seams.watchesCall(waiter, state.on),
          );
    return resolver?.state.position;
  }

  /**
   * Ends the wait `waiter`'s top frame stands at, if any: it resumes or goes on past it, or stops.
   * Its pending resolvers are cancelled and it goes; its decision, once it was decided.
   */
  end(waiter: LiveExecution): Decision | undefined {
    const top = waiter.frames.at(-1);
    const id = top === undefined ? undefined : takeWait(top);
    if (id === undefined) {
      return undefined;
    }
    for (const resolver of this.#pendingCases({ id })) {
      this.#cancel(resolver);
    }
    const { state } = this.#heap.of(id, 'wait');
    this.#heap.remove(id);
    return state.kind === 'decided' ? state : undefined;
  }

  /** Ends the wait `waiter` resumes from, which was decided: how it resumes. */
  take(waiter: LiveExecution): Decision {
    return this.end(waiter) ?? unreachable(`Execution ${waiter.id} resumed undecided.`);
  }

  /**
   * Decides `resolver`'s wait at its case with `value`, `resolver` resolved, unless another case
   * decided it already, which leaves `resolver` as it is; whether it did.
   */
  #decide(resolver: PendingResolver, value: Value): boolean {
    const wait = this.#waitOf(resolver);
    if (wait.state.kind !== 'pending') {
      return false;
    }
    this.#replace(resolver, { kind: 'resolved' });
    const decision = { position: resolver.state.position, value };
    const decided: Wait = { ...wait, state: { kind: 'decided', ...decision } };
    this.#heap.replace(decided);
    const waiter = this.#waiterOf(wait);
    if (waiter !== undefined && this.#stoppedWait(waiter)?.id === wait.id) {
      this.#ready(waiter, decided, decision);
    } else {
      this.#cancelLosers(decided);
    }
    return true;
  }

  /** Readies `waiter`, stopped at `wait`, decided: its losing resolvers cancelled first. */
  #ready(waiter: LiveExecution, wait: Wait, decision: Decision): void {
    this.#cancelLosers(wait);
    this.#seams.decided(waiter, decision);
  }

  /**
   * Cancels the resolvers still pending of `wait`, decided, but one on its waiter's own watch. One
   * registered lets go of its future, a losing case's (spec §8), which may wait in a slot's queue.
   */
  #cancelLosers(wait: Wait): void {
    for (const other of this.#pendingCases(wait)) {
      const { on } = other.state;
      if (on === undefined) {
        this.#cancel(other);
      } else if (!this.#keeps(wait, on)) {
        this.#cancel(other);
        this.#heap.noteLosersReleased();
      }
    }
  }

  /** Whether a resolver of `wait`, decided, stays registered on `future`: its own call's watch. */
  #keeps(wait: Wait, future: number): boolean {
    const waiter = this.#waiterOf(wait);
    return waiter !== undefined && this.#seams.watchesCall(waiter, future);
  }

  #cancel(resolver: Resolver): void {
    if (isPending(resolver)) {
      this.#replace(resolver, { kind: 'cancelled' });
    }
  }

  /** Replaces `resolver`'s state, noting it may have lost its holder, the wait it was registered by. */
  #replace(resolver: Resolver, state: Resolver['state']): void {
    this.#heap.replace({ ...resolver, state });
    this.#heap.noteReleased([resolver.id]);
  }

  /**
   * The execution waiting on `wait`; none for a disposal's call run on a carrier of its own, which
   * isn't on the heap (../segment/disposal-runs.ts) and never stops at a wait, since a `dispose`
   * can't await.
   */
  #waiterOf(wait: Wait): LiveExecution | undefined {
    return this.#heap.has(wait.waiter) ? this.#heap.of(wait.waiter, 'execution') : undefined;
  }

  /** The wait `waiter` is stopped at, if it is. */
  #stoppedWait(waiter: LiveExecution): Wait | undefined {
    const top = waiter.frames.at(-1);
    const id = top === undefined ? undefined : stoppedAt(top);
    return id === undefined ? undefined : this.#heap.of(id, 'wait');
  }

  /** The resolvers of `wait`'s cases still pending. */
  #pendingCases(wait: Pick<Wait, 'id'>): readonly PendingResolver[] {
    return this.#heap.find('cases', wait.id).filter(isPending);
  }

  #waitOf(resolver: PendingResolver): Wait {
    return this.#heap.of(resolver.state.wait, 'wait');
  }

  #resolver(handle: Value): Resolver {
    return this.#heap.of(handleObject(handle), 'resolver');
  }
}

function isPending(resolver: Resolver): resolver is PendingResolver {
  return resolver.state.kind === 'pending';
}

function registeredOn(resolver: PendingResolver): number {
  return resolver.state.on ?? unreachable(`Resolver ${resolver.id} was found on no future.`);
}
