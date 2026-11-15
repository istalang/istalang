/**
 * The waits of a run of compiled code (spec §6, §8; proposal 8, Rule 5): the interpreter's rules
 * (runtime/scheduler/instance/waits/), over objects rather than a heap, which the differential runner
 * holds the two to.
 *
 * - A waiter opens a wait and makes a resolver per case, which each case's `onAwait` registers on a
 *   future or resolves. The first resolver to resolve decides the wait, once; the others pending
 *   then are cancelled, their `onCancel` callbacks readied, what they awaited given up on.
 * - Futures resolved together decide in their settle order (settle-order.ts).
 * - What is registered on a future and a wait's cases are found by lookup here, as the interpreter's
 *   heap indexes them, so a future, a wait and a resolver each know only what they are.
 * - A `Resolver.of` callback, or an `onCancel` one, is readied as a call of its own (`called`).
 */

import type { Value } from '../../definition/values/values.ts';
import { Panic } from '../../runtime/natives.ts';
import type { Future } from './future.ts';
import { Resolver } from './resolver.ts';
import { settleOrder } from './settle-order.ts';
import type { Decision, Wait } from './wait.ts';

/** What waits reach outside themselves. */
export interface WaitSeams {
  /** Readies a call of the function value `callback` with `argumentValues`. */
  readonly called: (callback: Value, argumentValues: readonly Value[]) => void;
  /** A resolver now waits on `future`, served now if it can be (../slots/slots.ts). */
  readonly awaited: (future: Future) => void;
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
    const resolver = new Resolver({ kind: 'case', wait, position });
    this.#casesOf(wait).push(resolver);
    return resolver;
  }

  /** Whether a resolver still pending waits on `future`. */
  awaited(future: Future): boolean {
    return (this.#registered.get(future) ?? []).some((resolver) => resolver.state === 'pending');
  }

  /** Has `callback` called once `done` is cancelled: at once if it was, never once it resolved. */
  onCancel(done: Resolver, callback: Value): void {
    if (done.state === 'pending') {
      done.onCancel.push(callback);
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
      future.giveUp();
      return;
    }
    if (future.settled !== undefined) {
      this.resolve(done, future.settled.value);
      return;
    }
    const { target } = done.root;
    if (target.kind === 'case' && target.wait.decision !== undefined) {
      this.#lose(done, 'cancelled');
      future.giveUp();
      return;
    }
    if (!done.on.includes(future)) {
      done.on.push(future);
      const registered = this.#registered.get(future);
      if (registered === undefined) {
        this.#registered.set(future, [done]);
      } else {
        registered.push(done);
      }
    }
    this.#seams.awaited(future);
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
      const registered = this.#registered.get(future) ?? [];
      this.#registered.delete(future);
      return registered.map((resolver) => ({
        resolver,
        future,
        order: resolver.on.indexOf(future),
      }));
    });
    for (const { resolver, future } of settleOrder(registrations)) {
      if (
        resolver.state === 'pending' &&
        !this.#take(resolver, (future.settled as { readonly value: Value }).value)
      ) {
        this.#lose(resolver, 'cancelled');
      }
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
    wait.decide(decision);
    this.#cancelLosers(wait);
  }

  /** Cancels the resolvers still pending of `wait`, decided: losers, given up on. */
  #cancelLosers(wait: Wait): void {
    for (const resolver of this.#casesOf(wait)) {
      this.#end(resolver, 'cancelled', 'lost');
    }
  }

  /**
   * Ends `resolver`, if pending, as `state` says without deciding anything: its `onCancel` readied,
   * what it awaited given up on once it lost, its pending `Resolver.at` ones ending as it did.
   */
  #end(resolver: Resolver, state: 'resolved' | 'cancelled', ending: Ending): void {
    if (resolver.state !== 'pending') {
      return;
    }
    resolver.state = state;
    for (const callback of resolver.onCancel) {
      this.#seams.called(callback, []);
    }
    if (ending === 'lost') {
      for (const future of resolver.on) {
        future.giveUp();
      }
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

/** A new resolver calling `callback` with its value (`Resolver.of`). */
export function callbackResolver(callback: Value): Resolver {
  return new Resolver({ kind: 'callback', callback });
}

/** A new resolver deciding `done` with `(position, value)` (`Resolver.at`), pending while it is. */
export function positionedResolver(done: Resolver, position: bigint): Resolver {
  if (done.state !== 'pending') {
    return new Resolver({ kind: 'at', done, position }, 'cancelled');
  }
  const resolver = new Resolver({ kind: 'at', done, position });
  done.positions.push(resolver);
  return resolver;
}
