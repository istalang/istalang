/**
 * A running instance's waits and the language's resolvers (proposal 8, Rule 5): the one way a
 * waiting execution resumes, and the one way code is called back.
 *
 * - A waiter opens a wait, makes a resolver per case and hands each to that case's `onAwait`. A
 *   future's registers it on the future (`register`), several futures may register one resolver,
 *   and resolving a future resolves what is registered on it, found by lookup, so resolving costs
 *   what waits on that future, never a walk of every execution. Code may resolve one itself.
 * - A `Resolver.at` resolver decides another resolver with its value and a position, in the same
 *   step, running no code: `futures.first` races its futures so, deciding as a case does, and a
 *   loser of it consumes nothing. A `Resolver.of` resolver decides nothing: resolving it readies a
 *   call of its callback with the value, a driver of its own (`WaitSeams.called`), so in ista code
 *   it runs in a segment of its own, and decides whatever it decides only then. Cancelling any
 *   resolver readies its `onCancel` callbacks the same way, each once.
 * - What holds a wait's resolvers and their futures is the heap's (`Heap.holds`): a resolver
 *   nothing awaits that is let go of unresolved is a misused one (lifetimes/disposal.ts).
 * - A wait is decided once, by the first of its resolvers to resolve. Futures resolved together, or
 *   resolved when one is registered, decide in rank order (`#rank`): per wait, its lowest case;
 *   within it, the lowest position among `Resolver.at` ones; among the futures one resolver is
 *   registered on, the earliest registration. Deciding cancels the resolvers then pending, which do
 *   nothing after and let go of their futures, and so a resolver's pending `Resolver.at` ones; a
 *   wait's losing cases are let go of then (spec §8), so a losing `take` consumes nothing, as a slot
 *   passes over an operation no resolver awaits any more (slots.ts). A resolver on its waiter's own
 *   `disposing()` watch stays registered until the waiter moves on, as a disposal still resumes the
 *   call on it (§7), even one registered after the wait was decided; one registered on anything
 *   else then is cancelled. The waiter is ready once it is stopped at its wait and that is decided.
 * - Waiters that become ready together are readied in creation order, once each (§6), each
 *   followed by the `onCancel` callbacks of its losing cases, and then the callbacks of the
 *   `Resolver.of` resolvers resolved with them, in the order those were made.
 * - A resolver resolves once: a second `resolve` panics, a cancelled resolver ignores it, and
 *   `tryResolve` says whether it decided what it decides. One whose wait an earlier case's
 *   `onAwait` decided is cancelled once its waiter stops there, every case known; until then
 *   `resolve` takes its value to no effect, `tryResolve` cancels it, and letting it go panics
 *   (lifetimes/disposal.ts), so an awaitable's misuse is caught however the race went. Registering
 *   a resolver no longer pending does nothing.
 * - Waits and resolvers are heap objects, committed with the frames they resume, so a crash
 *   discards a decision with the segment that made it; a live run's stay in memory.
 */

import { handleTo, type Value } from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { type Decision, stoppedAt, takeWait } from '../../interpreter/suspension.ts';
import { Panic } from '../../natives.ts';
import type { ResolverTarget } from '../../snapshot/objects.ts';
import type { Settled } from './futures.ts';
import { type Heap, handleObject, type LiveExecution, type LiveObjectOf } from './heap.ts';

type Wait = LiveObjectOf<'wait'>;

type Resolver = LiveObjectOf<'resolver'>;

type PendingState = Extract<Resolver['state'], { readonly kind: 'pending' }>;

type PendingResolver = Resolver & { readonly state: PendingState };

type CaseTarget = Extract<ResolverTarget, { readonly kind: 'case' }>;

/** A pending resolver of a wait's case. */
type CaseResolver = Resolver & {
  readonly state: PendingState & { readonly target: CaseTarget };
};

/** How a pending resolver ends without deciding anything. */
type Ended = Exclude<Resolver['state'], PendingState>;

/** A pending resolver registered on a future that resolved, at its `order`-th registration. */
interface Registration {
  readonly resolver: PendingResolver;
  readonly future: number;
  readonly order: number;
}

/** What waits reach outside themselves. */
export interface WaitSeams {
  /** `waiter`, stopped at its wait, is to resume as `decision` says. */
  readonly decided: (waiter: LiveExecution, decision: Decision) => void;
  /** Whether `future` is a pending `disposing()` watch on the call `waiter` runs (§7). */
  readonly watchesCall: (waiter: LiveExecution, future: number) => boolean;
  /** Readies a call of the function value `callback` with `argumentValues`, a driver of its own. */
  readonly called: (callback: Value, argumentValues: readonly Value[]) => void;
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
    return this.#pending({ kind: 'case', wait: decides.id, position });
  }

  /** A new pending resolver calling `callback` with its value (`Resolver.of`); a handle to it. */
  callback(callback: Value): Value {
    return this.#pending({ kind: 'callback', callback });
  }

  /**
   * A new resolver deciding `done` with `(position, value)` (`Resolver.at`); a handle to it,
   * pending as long as `done` is, so cancelled at once when `done` no longer is.
   */
  at(done: Value, position: bigint): Value {
    const decides = this.#resolver(done);
    if (isPending(decides)) {
      return this.#pending({ kind: 'at', done: decides.id, position });
    }
    const cancelled = this.#heap.add(
      (id): Resolver => ({ kind: 'resolver', id, state: { kind: 'cancelled' } }),
    );
    return handleTo(cancelled.id);
  }

  /**
   * Has `callback` called once `done` is cancelled: at once when it was cancelled already, never
   * once it resolved.
   */
  onCancel(done: Value, callback: Value): void {
    const resolver = this.#resolver(done);
    if (isPending(resolver)) {
      const onCancel = [...resolver.state.onCancel, callback];
      this.#heap.replace({ ...resolver, state: { ...resolver.state, onCancel } });
    } else if (resolver.state.kind === 'cancelled') {
      this.#seams.called(callback, []);
    }
  }

  /**
   * Resolves the resolver `done` as the future `future` resolves, a future's `onAwait`: at once with
   * what `settled` says it resolved with, else registered on it; once its wait was decided, only on
   * its waiter's own `disposing()` watch, cancelled otherwise. One no longer pending is left as it
   * is.
   */
  register(done: Value, future: number, settled: Settled | undefined): void {
    const resolver = this.#resolver(done);
    if (!isPending(resolver)) {
      return;
    }
    if (settled !== undefined) {
      this.resolve(done, settled.value);
      return;
    }
    const root = this.#rootOf(resolver);
    if (isCase(root)) {
      const wait = this.#waitOf(root);
      if (wait.state.kind !== 'pending' && !this.#keeps(wait, future)) {
        this.#lose(resolver, { kind: 'cancelled' });
        return;
      }
    }
    const { state } = resolver;
    if (!state.on.includes(future)) {
      this.#heap.replace({ ...resolver, state: { ...state, on: [...state.on, future] } });
    }
  }

  /**
   * Resolves `done` with `value`: nothing once it is cancelled, and a panic once it resolved. One
   * whose wait another case decided takes the value to no effect, its case lost, so its `onCancel`
   * callbacks run and resolving it again still panics.
   */
  resolve(done: Value, value: Value): void {
    const resolver = this.#resolver(done);
    if (resolver.state.kind === 'resolved') {
      throw new Panic('A resolver was resolved twice.');
    }
    if (isPending(resolver) && !this.#take(resolver, value)) {
      this.#lose(resolver, { kind: 'resolved' });
    }
  }

  /**
   * Resolves `done` with `value` if that decides what it decides; whether it did. One whose wait
   * another case decided is cancelled instead.
   */
  tryResolve(done: Value, value: Value): boolean {
    const resolver = this.#resolver(done);
    if (!isPending(resolver)) {
      return false;
    }
    const took = this.#take(resolver, value);
    if (!took) {
      this.#lose(resolver, { kind: 'cancelled' });
    }
    return took;
  }

  /** Cancels `resolver` if it is still pending: as the future it is registered on is disposed. */
  cancel(resolver: Resolver): void {
    this.#cancel(this.#heap.of(resolver.id, 'resolver'));
  }

  /**
   * Resolves what is registered on `resolved`, futures that resolved together, each with what
   * `settled` says its future resolved with, in rank order (`#rank`): what something ranked
   * earlier decided first, a resolver taking nothing then, is cancelled.
   */
  settle(resolved: ReadonlySet<number>, settled: (future: number) => Settled): void {
    const ranked = [...this.#registrations(resolved)]
      .map((registration) => ({ registration, rank: this.#rank(registration.resolver) }))
      .toSorted(
        (first, second) =>
          compareRanks(first.rank, second.rank) ||
          first.registration.order - second.registration.order,
      );
    for (const { registration } of ranked) {
      const resolver = this.#heap.of(registration.resolver.id, 'resolver');
      if (isPending(resolver) && !this.#take(resolver, settled(registration.future).value)) {
        this.#lose(resolver, { kind: 'cancelled' });
      }
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
        : this.#pendingCases(wait).find(({ state }) =>
            state.on.some((future) => this.#seams.watchesCall(waiter, future)),
          );
    return resolver?.state.target.position;
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

  #pending(target: ResolverTarget): Value {
    const resolver = this.#heap.add(
      (id): Resolver => ({
        kind: 'resolver',
        id,
        state: { kind: 'pending', target, on: [], onCancel: [] },
      }),
    );
    return handleTo(resolver.id);
  }

  /**
   * Decides what the pending `resolver` decides with `value`, `resolver` resolved, unless something
   * decided that already; whether it did. Its pending `Resolver.at` ones lose.
   */
  #take(resolver: PendingResolver, value: Value): boolean {
    const { target } = this.#rootOf(resolver).state;
    if (target.kind === 'case' && this.#heap.of(target.wait, 'wait').state.kind !== 'pending') {
      return false;
    }
    this.#replace(resolver, { kind: 'resolved' });
    const own = resolver.state.target;
    if (own.kind === 'at') {
      this.#take(this.#pendingOf(own.done), positioned(own.position, value));
    } else if (own.kind === 'case') {
      this.#decide(own, value);
    } else {
      this.#seams.called(own.callback, [value]);
    }
    this.#cancelPositions(resolver);
    return true;
  }

  /**
   * What the pending `resolver` comes down to deciding: itself, or what the resolver a
   * `Resolver.at` one decides comes down to, pending as long as it is.
   */
  #rootOf(resolver: PendingResolver): PendingResolver {
    const { target } = resolver.state;
    return target.kind === 'at' ? this.#rootOf(this.#pendingOf(target.done)) : resolver;
  }

  /** Decides the pending wait `target` names at its case with `value`, readying its waiter. */
  #decide({ wait: id, position }: CaseTarget, value: Value): void {
    const wait = this.#heap.of(id, 'wait');
    const decision = { position, value };
    const decided: Wait = { ...wait, state: { kind: 'decided', ...decision } };
    this.#heap.replace(decided);
    const waiter = this.#waiterOf(wait);
    if (waiter !== undefined && this.#stoppedWait(waiter)?.id === wait.id) {
      this.#ready(waiter, decided, decision);
    } else {
      this.#cancelLosers(decided);
    }
  }

  /** Readies `waiter`, stopped at `wait`, decided, then cancels its losing resolvers. */
  #ready(waiter: LiveExecution, wait: Wait, decision: Decision): void {
    this.#seams.decided(waiter, decision);
    this.#cancelLosers(wait);
  }

  /**
   * Cancels the resolvers still pending of `wait`, decided, but one on its waiter's own watch. Each
   * lets go of what it awaited, a losing case's (spec §8), which may wait in a slot's queue.
   */
  #cancelLosers(wait: Wait): void {
    for (const other of this.#pendingCases(wait)) {
      if (!other.state.on.some((future) => this.#keeps(wait, future))) {
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

  /** Cancels `resolver`, if it is still pending. */
  #cancel(resolver: Resolver): void {
    if (isPending(resolver)) {
      this.#end(resolver, { kind: 'cancelled' });
    }
  }

  /**
   * Ends the pending `resolver` as `state` says without deciding anything: its `onCancel` run, and
   * its pending `Resolver.at` ones cancelled.
   */
  #end(resolver: PendingResolver, state: Ended): void {
    this.#replace(resolver, state);
    for (const callback of resolver.state.onCancel) {
      this.#seams.called(callback, []);
    }
    this.#cancelPositions(resolver);
  }

  /**
   * Ends the pending `resolver` as `state` says, its case lost, and so the resolver a `Resolver.at`
   * one decides in turn, whose case it lost too.
   */
  #lose(resolver: PendingResolver, state: Ended): void {
    this.#end(resolver, state);
    const { target } = resolver.state;
    if (target.kind === 'at') {
      this.#lose(this.#pendingOf(target.done), state);
    }
  }

  /** Cancels the pending `Resolver.at` resolvers deciding `resolver`, which no longer is pending. */
  #cancelPositions(resolver: Resolver): void {
    for (const position of this.#heap.find('positions', resolver.id)) {
      this.#cancel(position);
    }
  }

  /** Replaces `resolver`'s state, noting it may have lost its holder, what it was awaited by. */
  #replace(resolver: Resolver, state: Resolver['state']): void {
    this.#heap.replace({ ...resolver, state });
    this.#heap.noteReleased([resolver.id]);
  }

  /** The registrations on `resolved` of the resolvers pending, each at its earliest among them. */
  #registrations(resolved: ReadonlySet<number>): Iterable<Registration> {
    const earliest = new Map<number, Registration>();
    for (const future of resolved) {
      for (const resolver of this.#heap.find('resolvers', future).filter(isPending)) {
        const order = resolver.state.on.indexOf(future);
        const known = earliest.get(resolver.id);
        if (known === undefined || order < known.order) {
          earliest.set(resolver.id, { resolver, future, order });
        }
      }
    }
    return earliest.values();
  }

  /**
   * Where the pending `resolver` ranks among those resolving together, lowest first: what decides a
   * wait, by its waiter's creation then its case, before `Resolver.of` ones, by creation; a
   * `Resolver.at` one as what it decides, then by its position.
   */
  #rank(resolver: PendingResolver): readonly bigint[] {
    const { target } = resolver.state;
    if (target.kind === 'at') {
      return [...this.#rank(this.#pendingOf(target.done)), target.position];
    }
    return target.kind === 'case'
      ? [0n, BigInt(this.#heap.of(target.wait, 'wait').waiter), BigInt(target.position)]
      : [1n, BigInt(resolver.id)];
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
  #pendingCases(wait: Pick<Wait, 'id'>): readonly CaseResolver[] {
    return this.#heap.find('cases', wait.id).filter(isCase);
  }

  #waitOf(resolver: CaseResolver): Wait {
    return this.#heap.of(resolver.state.target.wait, 'wait');
  }

  /**
   * The resolver `id`, which a pending `Resolver.at` one decides, so pending itself: deciding a
   * resolver cancels the `Resolver.at` ones deciding it.
   */
  #pendingOf(id: number): PendingResolver {
    const resolver = this.#heap.of(id, 'resolver');
    return isPending(resolver) ? resolver : unreachable(`Resolver ${id} decided already.`);
  }

  #resolver(handle: Value): Resolver {
    return this.#heap.of(handleObject(handle), 'resolver');
  }
}

function isPending(resolver: Resolver): resolver is PendingResolver {
  return resolver.state.kind === 'pending';
}

function isCase(resolver: Resolver): resolver is CaseResolver {
  return resolver.state.kind === 'pending' && resolver.state.target.kind === 'case';
}

/** What a `Resolver.at` resolver decides its resolver with: `(position, value)`. */
function positioned(position: bigint, value: Value): Value {
  return { kind: 'tuple', elements: [position, value] };
}

/** Orders two ranks (`Waits.#rank`) element by element, a prefix first. */
function compareRanks(first: readonly bigint[], second: readonly bigint[]): number {
  for (const [index, element] of first.entries()) {
    const other = second[index];
    if (other === undefined) {
      return 1;
    }
    if (element !== other) {
      return element < other ? -1 : 1;
    }
  }
  return first.length < second.length ? -1 : 0;
}
