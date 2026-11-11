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
 *   resolved when one is registered, decide in order (settle-order.ts). Deciding cancels the
 *   resolvers then pending, which do nothing after and let go of their futures, and so a resolver's
 *   pending `Resolver.at` ones; a wait's losing cases are let go of then (spec §8), and what they
 *   awaited is given up on, so a slot passes over a losing `take`, which consumes nothing
 *   (../slots.ts). A wait that ends undecided, a `select` that doesn't wait going to `otherwise`,
 *   awaited nothing: its resolvers are withdrawn, which gives up on nothing, so what they were
 *   registered on is as it was. A resolver on its waiter's own `disposing()` watch stays registered
 *   until the waiter moves on, as a disposal still resumes the call on it (§7), even one registered
 *   after the wait was decided; one registered on anything else then is cancelled. The waiter is
 *   ready once it is stopped at its wait and that is decided.
 * - Waiters that become ready together are readied in creation order, once each (§6), each
 *   followed by the `onCancel` callbacks of its losing cases, and then the callbacks of the
 *   `Resolver.of` resolvers resolved with them, in the order those were made.
 * - A resolver resolves once: a second `resolve` panics, a cancelled resolver ignores it, and
 *   `tryResolve` says whether it decided what it decides. One whose wait an earlier case's
 *   `onAwait` decided is cancelled once its waiter stops there, every case known; until then
 *   `resolve` takes its value to no effect, `tryResolve` cancels it, and letting it go panics
 *   (lifetimes/disposal.ts), so an awaitable's misuse is caught however the race went. Registering
 *   a resolver no longer pending decides nothing, and gives up on its future as a loser does.
 * - Waits and resolvers are heap objects, committed with the frames they resume, so a crash
 *   discards a decision with the segment that made it; a live run's stay in memory.
 */

import { handleTo, type Value } from '../../../../definition/values/values.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import { type Decision, takeWait } from '../../../interpreter/suspension.ts';
import { Panic } from '../../../natives.ts';
import type { ResolverTarget } from '../../../snapshot/objects.ts';
import type { Settled } from '../futures.ts';
import { type Heap, handleObject, type LiveExecution } from '../heap.ts';
import { type Ending, type EndingSeams, ResolverEndings } from './endings.ts';
import {
  type CaseResolver,
  type CaseTarget,
  isCase,
  isPending,
  type PendingResolver,
  pendingCases,
  pendingOf,
  positioned,
  type Resolver,
  rootOf,
  stoppedWait,
  type Wait,
  waiterOf,
} from './resolvers.ts';
import { settleOrder } from './settle-order.ts';

/** What waits reach outside themselves. */
export interface WaitSeams extends EndingSeams {
  /** `waiter`, stopped at its wait, is to resume as `decision` says. */
  readonly decided: (waiter: LiveExecution, decision: Decision) => void;
  /** A resolver now waits on `future`, which is served now if it can be (slots.ts). */
  readonly awaited: (future: number) => void;
}

export class Waits {
  readonly #heap: Heap;
  readonly #seams: WaitSeams;
  readonly #endings: ResolverEndings;

  constructor(heap: Heap, seams: WaitSeams) {
    this.#heap = heap;
    this.#seams = seams;
    this.#endings = new ResolverEndings(heap, seams);
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
   * its waiter's own `disposing()` watch, cancelled otherwise. A resolver that can decide nothing any
   * more, one no longer pending or whose case lost so, awaits `future` as a loser: given up on.
   */
  register(done: Value, future: number, settled: Settled | undefined): void {
    const resolver = this.#resolver(done);
    if (!isPending(resolver)) {
      this.#seams.givenUp(future);
      return;
    }
    if (settled !== undefined) {
      this.resolve(done, settled.value);
      return;
    }
    const root = rootOf(this.#heap, resolver);
    if (isCase(root)) {
      const wait = this.#waitOf(root);
      if (wait.state.kind !== 'pending' && !this.#endings.keeps(wait, future)) {
        this.#endings.lose(resolver, { kind: 'cancelled' });
        this.#seams.givenUp(future);
        return;
      }
    }
    const { state } = resolver;
    if (!state.on.includes(future)) {
      this.#heap.replace({ ...resolver, state: { ...state, on: [...state.on, future] } });
    }
    this.#seams.awaited(future);
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
      this.#endings.lose(resolver, { kind: 'resolved' });
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
      this.#endings.lose(resolver, { kind: 'cancelled' });
    }
    return took;
  }

  /** Cancels `resolver` if it is still pending: as the future it is registered on is disposed. */
  cancel(resolver: Resolver): void {
    this.#endings.cancel(this.#heap.of(resolver.id, 'resolver'), 'withdrawn');
  }

  /**
   * Resolves what is registered on `resolved`, futures that resolved together, each with what
   * `settled` says its future resolved with, in the order they decide (settle-order.ts): what
   * something earlier decided first, a resolver taking nothing then, is cancelled.
   */
  settle(resolved: ReadonlySet<number>, settled: (future: number) => Settled): void {
    for (const registration of settleOrder(this.#heap, resolved)) {
      const resolver = this.#heap.of(registration.resolver.id, 'resolver');
      if (isPending(resolver) && !this.#take(resolver, settled(registration.future).value)) {
        this.#endings.lose(resolver, { kind: 'cancelled' });
      }
    }
  }

  /**
   * Readies `waiter`, which has just stopped at its wait, if that is decided already: decided while
   * its cases' `onAwait`s ran, so the resolvers made after are cancelled now, every case known.
   */
  stopped(waiter: LiveExecution): void {
    const wait = stoppedWait(this.#heap, waiter);
    if (wait?.state.kind === 'decided') {
      this.#ready(waiter, wait, wait.state);
    }
  }

  /**
   * The case of the wait `waiter` is stopped at whose resolver is registered on a `disposing()`
   * watch of its own call, by position: the case a disposal of that call resumes it on (§7).
   */
  cleanupCase(waiter: LiveExecution): number | undefined {
    const wait = stoppedWait(this.#heap, waiter);
    const resolver =
      wait === undefined
        ? undefined
        : pendingCases(this.#heap, wait).find(({ state }) =>
            state.on.some((future) => this.#seams.watchesCall(waiter, future)),
          );
    return resolver?.state.target.position;
  }

  /**
   * Ends the wait `waiter`'s top frame stands at, if any: it resumes past it, or stops there, its
   * call disposed, whose cases lose (§8). Its pending resolvers are cancelled and it goes; its
   * decision, once it was decided.
   */
  end(waiter: LiveExecution): Decision | undefined {
    return this.#endWith(waiter, 'lost');
  }

  /**
   * Ends the wait of the `select` that doesn't wait `waiter`'s top frame stands at (§8): its
   * decision, once a case decided it; else it goes to `otherwise`, having awaited nothing, so its
   * resolvers are withdrawn.
   */
  endNonBlocking(waiter: LiveExecution): Decision | undefined {
    return this.#endWith(waiter, 'withdrawn');
  }

  /** Ends the wait `waiter` resumes from, which was decided: how it resumes. */
  take(waiter: LiveExecution): Decision {
    return this.end(waiter) ?? unreachable(`Execution ${waiter.id} resumed undecided.`);
  }

  /** Ends the wait `waiter`'s top frame stands at, if any, its pending resolvers ending so. */
  #endWith(waiter: LiveExecution, ending: Ending): Decision | undefined {
    const top = waiter.frames.at(-1);
    const id = top === undefined ? undefined : takeWait(top);
    if (id === undefined) {
      return undefined;
    }
    for (const resolver of pendingCases(this.#heap, { id })) {
      this.#endings.cancel(resolver, ending);
    }
    const { state } = this.#heap.of(id, 'wait');
    this.#heap.remove(id);
    return state.kind === 'decided' ? state : undefined;
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
    const { target } = rootOf(this.#heap, resolver).state;
    if (target.kind === 'case' && this.#heap.of(target.wait, 'wait').state.kind !== 'pending') {
      return false;
    }
    this.#endings.replace(resolver, { kind: 'resolved' });
    const own = resolver.state.target;
    if (own.kind === 'at') {
      this.#take(pendingOf(this.#heap, own.done), positioned(own.position, value));
    } else if (own.kind === 'case') {
      this.#decide(own, value);
    } else {
      this.#seams.called(own.callback, [value]);
    }
    this.#endings.cancelPositions(resolver, 'lost');
    return true;
  }

  /** Decides the pending wait `target` names at its case with `value`, readying its waiter. */
  #decide({ wait: id, position }: CaseTarget, value: Value): void {
    const wait = this.#heap.of(id, 'wait');
    const decision = { position, value };
    const decided: Wait = { ...wait, state: { kind: 'decided', ...decision } };
    this.#heap.replace(decided);
    const waiter = waiterOf(this.#heap, wait);
    if (waiter !== undefined && stoppedWait(this.#heap, waiter)?.id === wait.id) {
      this.#ready(waiter, decided, decision);
    } else {
      this.#endings.cancelLosers(decided);
    }
  }

  /** Readies `waiter`, stopped at `wait`, decided, then cancels its losing resolvers. */
  #ready(waiter: LiveExecution, wait: Wait, decision: Decision): void {
    this.#seams.decided(waiter, decision);
    this.#endings.cancelLosers(wait);
  }

  #waitOf(resolver: CaseResolver): Wait {
    return this.#heap.of(resolver.state.target.wait, 'wait');
  }

  #resolver(handle: Value): Resolver {
    return this.#heap.of(handleObject(handle), 'resolver');
  }
}
