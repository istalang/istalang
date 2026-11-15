/**
 * The waits of a run of compiled code (spec §6, §8; proposal 8, Rule 5): the interpreter's rules
 * (runtime/scheduler/instance/waits/), over objects rather than a heap, which the differential runner
 * holds the two to.
 *
 * - A waiter opens a wait and makes a resolver per case, which each case's `onAwait` registers on a
 *   future or resolves. The first resolver to resolve decides the wait, once; the others pending
 *   then are cancelled, their `onCancel` callbacks readied. Slots, which a losing case gives up
 *   on, are ista data (proposal 8, Rule 6), which no compiled code reaches.
 * - Futures resolved together decide in their settle order (runtime/settle-order.ts).
 * - What is registered on a future and a wait's cases are found by lookup here, as the interpreter's
 *   heap indexes them, so a future, a wait and a resolver each know only what they are.
 * - A `Resolver.of` callback, or an `onCancel` one, is readied as a call of its own (`called`).
 * - Every change of a future's, a wait's or a resolver's state is told to the run's lifetimes
 *   (`touched`), since what it holds follows from it (live/lifetimes/holdings.ts), and a resolver
 *   is made there.
 */

import type { Value } from '../../definition/values/values.ts';
import { Panic } from '../../runtime/natives.ts';
import { type RankedTarget, settleOrder } from '../../runtime/settle-order.ts';
import type { Future } from './future.ts';
import { Resolver } from './resolver.ts';
import type { Decision, Wait } from './wait.ts';

/** What waits reach outside themselves. */
export interface WaitSeams {
  /** Readies a call of the function value `callback` with `argumentValues`. */
  readonly called: (callback: Value, argumentValues: readonly Value[]) => void;
  /** Readies a waiter, `resume` resuming it. */
  readonly resumed: (resume: () => void) => void;
  /** `resolver` was made, held by nothing yet. */
  readonly made: (resolver: Resolver) => Resolver;
  /** `object`'s state changed. */
  readonly touched: (object: Future | Wait | Resolver) => void;
  /** Whether `future` is a `disposing()` watch on the call of future `call` (§7). */
  readonly watchesCall: (call: Future, future: Future) => boolean;
}

type Ending = 'lost' | 'withdrawn';

export class Waits {
  readonly #seams: WaitSeams;
  /** The resolvers registered on each future still pending, in the order they were. */
  readonly #registered = new WeakMap<Future, Resolver[]>();
  /** Each wait's cases' resolvers. */
  readonly #cases = new WeakMap<Wait, Resolver[]>();

  constructor(seams: WaitSeams) {
    this.#seams = seams;
  }

  /** A new resolver of `wait`'s case `position`. */
  resolver(wait: Wait, position: number): Resolver {
    const resolver = this.#seams.made(new Resolver({ kind: 'case', wait, position }));
    this.#casesOf(wait).push(resolver);
    return resolver;
  }

  /** A new resolver calling `callback` with its value (`Resolver.of`). */
  callback(callback: Value): Resolver {
    return this.#seams.made(new Resolver({ kind: 'callback', callback }));
  }

  /** A new resolver deciding `done` with `(position, value)` (`Resolver.at`), pending while it is. */
  at(done: Resolver, position: bigint): Resolver {
    if (done.state !== 'pending') {
      return this.#seams.made(new Resolver({ kind: 'at', done, position }, 'cancelled'));
    }
    const resolver = this.#seams.made(new Resolver({ kind: 'at', done, position }));
    done.positions.push(resolver);
    this.#seams.touched(done);
    return resolver;
  }

  /** The waiter of `wait` moves on from it, resumed or stopped: its pending cases lose (§8). */
  ended(wait: Wait): void {
    for (const resolver of this.#casesOf(wait)) {
      this.#end(resolver, 'cancelled', 'lost');
    }
  }

  /** The resolvers registered on `future`, in the order they were. */
  registeredOn(future: Future): readonly Resolver[] {
    return this.#registered.get(future) ?? [];
  }

  /** `wait`'s cases' resolvers. */
  casesOf(wait: Wait): readonly Resolver[] {
    return this.#cases.get(wait) ?? [];
  }

  /** Cancels the pending `resolver`, readying its `onCancel` callbacks (proposal 8, Rule 5). */
  cancel(resolver: Resolver): void {
    this.#end(resolver, 'cancelled', 'lost');
  }

  /** Has `callback` called once `done` is cancelled: at once if it was, never once it resolved. */
  onCancel(done: Resolver, callback: Value): void {
    if (done.state === 'pending') {
      done.onCancel.push(callback);
      this.#seams.touched(done);
    } else if (done.state === 'cancelled') {
      this.#seams.called(callback, []);
    }
  }

  /**
   * Resolves `done` as `future` resolves (a future's `onAwait`): at once if it has, else registered
   * on it. A resolver that can decide nothing any more awaits `future` as a loser: given up on.
   */
  register(done: Resolver, future: Future): void {
    if (done.state !== 'pending') {
      return;
    }
    if (future.settled !== undefined) {
      this.resolve(done, future.settled.value);
      return;
    }
    const { target } = done.root;
    if (
      target.kind === 'case' &&
      target.wait.decision !== undefined &&
      !this.#keeps(target.wait, future)
    ) {
      this.#lose(done, 'cancelled');
      return;
    }
    if (!done.on.includes(future)) {
      done.on.push(future);
      this.#seams.touched(done);
      const registered = this.#registered.get(future);
      if (registered === undefined) {
        this.#registered.set(future, [done]);
      } else {
        registered.push(done);
      }
    }
  }

  /**
   * Resolves `done` with `value`: nothing once it is cancelled, a panic once it resolved. One whose
   * wait another case decided takes the value to no effect, its case lost.
   */
  resolve(done: Resolver, value: Value): void {
    if (done.state === 'resolved') {
      throw new Panic('A resolver was resolved twice.');
    }
    if (done.state === 'pending' && !this.#take(done, value)) {
      this.#lose(done, 'resolved');
    }
  }

  /** Resolves `done` with `value` if that decides what it decides; whether it did. */
  tryResolve(done: Resolver, value: Value): boolean {
    if (done.state !== 'pending') {
      return false;
    }
    const took = this.#take(done, value);
    if (!took) {
      this.#lose(done, 'cancelled');
    }
    return took;
  }

  /** Resolves `resolutions`' futures together, one event, then decides what they decide in order. */
  resolveTogether(resolutions: readonly (readonly [Future, Value])[]): void {
    const registrations = resolutions.flatMap(([future, value]) => {
      future.settled = { value };
      this.#seams.touched(future);
      const registered = this.#registered.get(future) ?? [];
      this.#registered.delete(future);
      return registered
        .filter((resolver) => resolver.state === 'pending')
        .map((resolver) => ({ resolver, future, order: resolver.on.indexOf(future) }));
    });
    for (const { resolver, future } of settleOrder(registrations, rankedTarget)) {
      if (
        resolver.state === 'pending' &&
        !this.#take(resolver, (future.settled as { readonly value: Value }).value)
      ) {
        this.#lose(resolver, 'cancelled');
      }
    }
  }

  /**
   * `wait`'s waiter stopped at it, every case known: `resume` resumes it with how the wait is
   * decided, once it is. Decided already, the waiter is ready now, and a resolver made after the decision, by a later
   * case's `onAwait`, loses, its `onCancel` readied after the waiter.
   */
  stopped(wait: Wait, resume: (decision: Decision) => void): void {
    wait.stop(resume);
    if (wait.decision !== undefined) {
      this.#ready(wait);
    }
  }

  /**
   * Ends the wait of a `select` that doesn't wait (§8): its decision, once a case decided it; else
   * it goes to `otherwise`, having awaited nothing, its resolvers withdrawn.
   */
  endNonBlocking(wait: Wait): Decision | undefined {
    for (const resolver of this.#casesOf(wait)) {
      this.#end(resolver, 'cancelled', 'withdrawn');
    }
    return wait.decision;
  }

  /** Decides what the pending `resolver` decides with `value`, unless that is decided; whether it did. */
  #take(resolver: Resolver, value: Value): boolean {
    const { target: root } = resolver.root;
    if (root.kind === 'case' && root.wait.decision !== undefined) {
      return false;
    }
    resolver.state = 'resolved';
    this.#seams.touched(resolver);
    const { target } = resolver;
    if (target.kind === 'at') {
      this.#take(target.done, { kind: 'tuple', elements: [target.position, value] });
    } else if (target.kind === 'case') {
      this.#decide(target.wait, { position: target.position, value });
    } else {
      this.#seams.called(target.callback, [value]);
    }
    this.#cancelPositions(resolver, 'lost');
    return true;
  }

  #decide(wait: Wait, decision: Decision): void {
    wait.decision = decision;
    this.#seams.touched(wait);
    if (wait.stopped) {
      this.#ready(wait);
    } else {
      this.#cancelLosers(wait);
    }
  }

  /** Readies `wait`'s waiter, stopped at it and decided, then cancels its losers. */
  #ready(wait: Wait): void {
    this.#seams.resumed(() => wait.resume());
    this.#cancelLosers(wait);
  }

  /** Cancels the resolvers still pending of `wait`, decided: losers, given up on. */
  #cancelLosers(wait: Wait): void {
    for (const resolver of this.#casesOf(wait).filter(({ state }) => state === 'pending')) {
      const kept = resolver.on.filter((future) => this.#keeps(wait, future));
      if (kept.length === 0) {
        this.#end(resolver, 'cancelled', 'lost');
      } else {
        this.#keepOnly(resolver, kept);
      }
    }
  }

  /**
   * Whether a case resolver of `wait`, decided, stays registered on `future`: its waiter's own
   * call's `disposing()` watch, as a disposal still resumes the call on it until the waiter moves on
   * (§7).
   */
  #keeps(wait: Wait, future: Future): boolean {
    return wait.call !== undefined && this.#seams.watchesCall(wait.call, future);
  }

  /** `resolver` stays registered on `kept` alone, giving up the rest of what it awaited. */
  #keepOnly(resolver: Resolver, kept: readonly Future[]): void {
    for (const future of resolver.on.filter((each) => !kept.includes(each))) {
      const registered = this.#registered.get(future);
      registered?.splice(registered.indexOf(resolver), 1);
    }
    resolver.on.splice(0, resolver.on.length, ...kept);
    this.#seams.touched(resolver);
  }

  /**
   * Ends `resolver`, if pending, as `state` says without deciding anything: its `onCancel` readied,
   * its pending `Resolver.at` ones ending as it did.
   */
  #end(resolver: Resolver, state: 'resolved' | 'cancelled', ending: Ending): void {
    if (resolver.state !== 'pending') {
      return;
    }
    resolver.state = state;
    this.#seams.touched(resolver);
    for (const callback of resolver.onCancel) {
      this.#seams.called(callback, []);
    }
    this.#cancelPositions(resolver, ending);
  }

  /** Ends the pending `resolver`, its case lost, and so what a `Resolver.at` one decides in turn. */
  #lose(resolver: Resolver, state: 'resolved' | 'cancelled'): void {
    const { target } = resolver;
    this.#end(resolver, state, 'lost');
    if (target.kind === 'at') {
      this.#lose(target.done, state);
    }
  }

  #cancelPositions(resolver: Resolver, ending: Ending): void {
    for (const position of resolver.positions) {
      this.#end(position, 'cancelled', ending);
    }
  }

  #casesOf(wait: Wait): Resolver[] {
    let cases = this.#cases.get(wait);
    if (cases === undefined) {
      cases = [];
      this.#cases.set(wait, cases);
    }
    return cases;
  }
}

/** What `resolver` decides, as the settle order ranks it. */
function rankedTarget(resolver: Resolver): RankedTarget<Resolver> {
  const { target } = resolver;
  switch (target.kind) {
    case 'case':
      return { kind: 'case', waiter: target.wait.waiter, position: target.position };
    case 'at':
      return target;
    default:
      return { kind: 'callback', made: resolver.object };
  }
}
