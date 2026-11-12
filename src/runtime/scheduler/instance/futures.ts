/**
 * The futures of a running instance (spec §6): every wait is on one, and a future resolves once
 * and stays resolved.
 *
 * - Who waits on a future is the resolvers registered on it (waits/index.ts): resolving it decides
 *   them. No future waits on another; code that waits on several registers a resolver on each, as
 *   `futures.first` registers a `Resolver.at` of its own.
 * - An answer to another instance's call to a mock (§10) waits on a future too. When it resolves
 *   with a future, as the replacement of a function returning one does, the answer waits on that
 *   one instead; when it resolves with anything else, the answer is given (`Answered`). An
 *   instance's outcome follows a future the same way (`endOf`, §9): no future leaves its instance.
 * - A watch on another instance resolves once its condition holds, at the start of a segment, as a
 *   timer does when it is due: the instance has ended (§9), or under a test it is idle or waits at
 *   a waypoint (§10).
 */

import { handleTarget, handleTo, type Value } from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { FutureState, Watch } from '../../snapshot/objects.ts';
import type { CallerFuture } from '../testing/test-world.ts';
import type { DisposalNotices } from './disposal-notices.ts';
import { type Heap, handleObject, type LiveObjectOf } from './heap.ts';
import type { Waits } from './waits/index.ts';

/** A future that has resolved, with its value. */
export interface Settled {
  readonly value: Value;
}

/**
 * Who a call made into an instance from outside answers: the future `instance` named `token`, or
 * with no `instance`, the one its host named so, for a host's call into a context (§9).
 */
export interface Caller {
  readonly instance?: string | undefined;
  readonly token: string;
}

/**
 * An answer given: the value that fills the caller's future, and whether it came from a future the
 * call returned rather than from the call itself.
 */
export interface Answered extends Caller {
  readonly value: Value;
  readonly followed: boolean;
}

/** An answer to a call made from outside was given. */
export type AnswerGiven = (answered: Answered) => void;

/** A pending future to resolve, and its value. */
export interface Resolution {
  readonly id: number;
  readonly value: Value;
}

export class Futures {
  readonly #heap: Heap;
  readonly #waits: Waits;
  readonly #answered: AnswerGiven;
  /** What observes a pending future's disposal, which resolving it ends. */
  readonly #notices: DisposalNotices;

  /**
   * Futures on `heap`, deciding `waits` as they resolve, telling `answered` each answer, and ending
   * the `notices` of each they resolve.
   */
  constructor(heap: Heap, waits: Waits, notices: DisposalNotices, answered: AnswerGiven) {
    this.#heap = heap;
    this.#waits = waits;
    this.#notices = notices;
    this.#answered = answered;
  }

  /** A new future in `state`; its id. */
  create(state: FutureState): number {
    return this.#heap.add((id) => ({ kind: 'future', id, state })).id;
  }

  /** A handle to a new future in `state`. */
  createHandle(state: FutureState): Value {
    return handleTo(this.create(state));
  }

  /** The value of the future `handle` names, once it has resolved. */
  settled(handle: Value): Settled | undefined {
    const { state } = this.#future(handle);
    return state.kind === 'resolved' ? { value: state.value } : undefined;
  }

  /** Resolves the pending future `id` with `value`, as `resolveTogether` does. */
  resolve(id: number, value: Value): void {
    this.resolveTogether([{ id, value }]);
  }

  /**
   * Resolves the pending futures `resolutions` names together, one event resolving them at once,
   * then decides every wait on any of them at its first case among them.
   */
  resolveTogether(resolutions: readonly Resolution[]): void {
    const together = new Set<number>();
    for (const { id, value } of resolutions) {
      this.#settle(id, value);
      together.add(id);
    }
    this.#waits.settle(together, (future) => ({ value: this.#valueOf(future) }));
    for (const future of together) {
      for (const answer of this.#heap.find('answers', future)) {
        this.#answer(answer);
      }
    }
  }

  /**
   * Gives `answer` the value its future resolved with, or has it wait on the future that value is.
   */
  #answer(answer: LiveObjectOf<'answer'>): void {
    const value = this.#valueOf(answer.future);
    const next = this.#futureIn(value);
    if (next !== undefined) {
      const following = { ...answer, future: next, followed: true };
      this.#heap.replace(following);
      if (this.settled(value) !== undefined) {
        this.#answer(following);
      }
      return;
    }
    this.#heap.remove(answer.id);
    const { kind: _kind, id: _id, future: _future, ...given } = answer;
    this.#answered({ ...given, value });
  }

  /**
   * What `future` ends with, as a value leaving its instance does: its value once it has resolved,
   * a future it resolved with followed in turn, as an answer follows it; undefined while pending.
   */
  endOf(future: number): Settled | undefined {
    const settled = this.settled(handleTo(future));
    const next = settled === undefined ? undefined : this.#futureIn(settled.value);
    return next === undefined ? settled : this.endOf(next);
  }

  /** The future `value` is a handle to while it is pending, which code giving `value` waits on. */
  pendingIn(value: Value): number | undefined {
    const future = this.#futureIn(value);
    return future === undefined || this.endOf(future) !== undefined ? undefined : future;
  }

  /** The future `value` is a handle to, which no value leaving its instance can be; else none. */
  #futureIn(value: Value): number | undefined {
    const target = handleTarget(value);
    return target !== undefined && this.#heap.objectOf(target).kind === 'future'
      ? target
      : undefined;
  }

  /** An answer to the call `caller` made, given once `future` resolves (§9, §10). */
  answer(future: number, caller: Caller): void {
    const answer = this.#heap.add(
      (id): LiveObjectOf<'answer'> => ({ kind: 'answer', id, future, ...caller, followed: false }),
    );
    if (this.#heap.of(future, 'future').state.kind === 'resolved') {
      this.#answer(answer);
    }
  }

  /**
   * Drops the answers that would fill `withdrawn`, futures their callers let go of, so what each
   * answer waits on is let go too (§7, §10).
   */
  withdraw(withdrawn: readonly CallerFuture[]): void {
    for (const answer of this.#heap.objectsOf('answer')) {
      if (
        withdrawn.some(
          ({ instance, token }) => answer.instance === instance && answer.token === token,
        )
      ) {
        this.#heap.remove(answer.id);
      }
    }
  }

  /**
   * Resolves together every pending watch whose condition `holds` says holds, with what it gives;
   * whether any did.
   */
  resolveWatches(holds: (watch: Watch) => Value | undefined): boolean {
    const resolutions = this.#heap.find('pending', 'watch').flatMap(({ id, state }) => {
      const value = state.kind === 'watch' ? holds(state) : undefined;
      return value === undefined ? [] : [{ id, value }];
    });
    this.resolveTogether(resolutions);
    return resolutions.length > 0;
  }

  /** The value of the resolved future `id`. */
  #valueOf(id: number): Value {
    const { state } = this.#heap.of(id, 'future');
    if (state.kind !== 'resolved') {
      unreachable(`Future ${id} hasn't resolved.`);
    }
    return state.value;
  }

  /** Marks the pending future `id` resolved with `value`. */
  #settle(id: number, value: Value): void {
    const future = this.#heap.of(id, 'future');
    if (future.state.kind === 'resolved') {
      unreachable(`Future ${id} has resolved already.`);
    }
    this.#heap.replace({ ...future, state: { kind: 'resolved', value } });
    this.#notices.forget(id);
  }

  /**
   * Resolves the future its host named `token` with what `value` makes (§9); false when no future
   * pending on the host has that name, which makes nothing: a value arriving may add objects to
   * the heap.
   */
  resolveHost(token: string, value: () => Value): boolean {
    const future = this.#hostFuture(token);
    if (future !== undefined) {
      this.resolve(future.id, value());
    }
    return future !== undefined;
  }

  /** Whether a future pending on the host has the name `token`. */
  waitsOnHost(token: string): boolean {
    return this.#hostFuture(token) !== undefined;
  }

  /** The futures pending on the host, by id. */
  awaitedFromHost(): readonly number[] {
    return this.#heap.find('pending', 'host').map(({ id }) => id);
  }

  /**
   * A future something outside the instance fills, as a host does: another instance's answer to a
   * mock's call, or a host's promise in a live run. Its token is named by `tokenOf` from the
   * future's own id; its id and the token.
   */
  createFilled(tokenOf: (id: number) => string): { readonly id: number; readonly token: string } {
    const future = this.#heap.add((id) => ({
      kind: 'future',
      id,
      state: { kind: 'host', token: tokenOf(id) },
    }));
    return { id: future.id, token: tokenOf(future.id) };
  }

  #hostFuture(token: string): LiveObjectOf<'future'> | undefined {
    const [future] = this.#heap.find('hostFutures', token);
    return future;
  }

  /** When the earliest pending timer is due; undefined with none. */
  nextTimer(): bigint | undefined {
    return this.#heap
      .find('pending', 'timer')
      .reduce<bigint | undefined>(
        (earliest, { state }) =>
          state.kind === 'timer' && (earliest === undefined || state.at < earliest)
            ? state.at
            : earliest,
        undefined,
      );
  }

  /**
   * Resolves every timer due at `now`, earliest first, those due at one instant together; whether
   * any was.
   */
  resolveDueTimers(now: bigint): boolean {
    const due = this.#heap
      .find('pending', 'timer')
      .flatMap(({ id, state }) =>
        state.kind === 'timer' && state.at <= now ? [{ id, ...state }] : [],
      );
    const instants = Map.groupBy(due, ({ at }) => at);
    for (const at of [...instants.keys()].toSorted((first, second) => Number(first - second))) {
      this.resolveTogether((instants.get(at) ?? []).map(({ id }) => ({ id, value: null })));
    }
    return due.length > 0;
  }

  #future(handle: Value): LiveObjectOf<'future'> {
    return this.#heap.of(handleObject(handle), 'future');
  }
}
