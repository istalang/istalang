/**
 * The futures of a running instance (spec §6): every wait is on one, and a future resolves once
 * and stays resolved.
 *
 * - Who waits on a future is read from the waiters' frames, never stored: an execution waits on
 *   the futures its top frame's `await` or `select` names (definition/instructions/flow.ts).
 *   Resolving a future readies its waiters in creation order, once each.
 * - `futures.first(fs)` is the one future that waits on others: it resolves with the position and
 *   value of the first of them to resolve, the lowest position among those resolved together.
 *   Which `first`s wait on a future is read from their lists, the same way.
 * - An answer to another instance's call to a mock (§10) waits on a future too. When it resolves
 *   with a future, as the replacement of a function returning one does, the answer waits on that
 *   one instead; when it resolves with anything else, the answer is given (`Answered`).
 * - A watch on another instance resolves once its condition holds, at the start of a segment, as a
 *   timer does when it is due: the instance has ended (§9), or under a test it is idle or waits at
 *   a waypoint (§10).
 */

import { awaitedRegisters } from '../../../definition/instructions/flow.ts';
import { handleTarget, handleTo, type Value } from '../../../definition/values/values.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { readRegister } from '../../interpreter/machine.ts';
import { Panic } from '../../natives.ts';
import type { FutureState, Watch } from '../../snapshot/objects.ts';
import type { CallerFuture } from '../testing/test-world.ts';
import { type Heap, handleObject, type LiveExecution, type LiveObjectOf } from './heap.ts';

/** A pending `futures.first`. */
type FirstFuture = LiveObjectOf<'future'> & {
  readonly state: Extract<FutureState, { kind: 'first' }>;
};

/** A future that has resolved, with its value. */
export interface Settled {
  readonly value: Value;
}

/**
 * An answer given: the value that fills the future `instance` named `token`, and whether it came
 * from a future the replacement returned rather than from the replacement itself.
 */
export interface Answered {
  readonly instance: string;
  readonly token: string;
  readonly value: Value;
  readonly followed: boolean;
}

/** What futures tell the instance they belong to. */
export interface FutureEvents {
  /** `execution` waits on a future that resolved. */
  readonly ready: (execution: LiveExecution) => void;
  /** An answer to another instance's call was given. */
  readonly answered: (answered: Answered) => void;
}

export class Futures {
  readonly #heap: Heap;
  readonly #events: FutureEvents;

  /** Futures on `heap`, telling `events` what their resolving readies and answers. */
  constructor(heap: Heap, events: FutureEvents) {
    this.#heap = heap;
    this.#events = events;
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

  /**
   * Resolves the pending future `id` with `value`, and with it every `first` it makes resolve,
   * then readies everything waiting on any of them. A `first` is created after the futures it
   * races, so taking the pending ones in creation order finds them all in one pass, and each one's
   * members are settled before it: it resolves at the lowest position that resolved together.
   */
  resolve(id: number, value: Value): void {
    this.#settle(id, value);
    const together = new Set([id]);
    for (const first of this.#pendingFirsts()) {
      const position = first.state.futures.findIndex((member) => together.has(member));
      const winner = first.state.futures[position];
      if (winner !== undefined) {
        this.#settle(first.id, positioned(position, this.#valueOf(winner)));
        together.add(first.id);
      }
    }
    for (const execution of this.#heap.objectsOf('execution')) {
      if (waitedOn(execution).some((future) => together.has(future))) {
        this.#events.ready(execution);
      }
    }
    for (const future of together) {
      for (const answer of this.#heap.find('answers', future)) {
        this.#answer(answer);
      }
    }
  }

  /** Gives `answer` the value its future resolved with, or has it wait on the future that value is. */
  #answer(answer: LiveObjectOf<'answer'>): void {
    const value = this.#valueOf(answer.future);
    const next = handleTarget(value);
    if (next !== undefined && this.#heap.objectOf(next).kind === 'future') {
      const following = { ...answer, future: next, followed: true };
      this.#heap.replace(following);
      if (this.settled(value) !== undefined) {
        this.#answer(following);
      }
      return;
    }
    this.#heap.remove(answer.id);
    const { instance, token, followed } = answer;
    this.#events.answered({ instance, token, value, followed });
  }

  /** An answer to the call another instance named `token`, given once `future` resolves (§10). */
  answer(future: number, instance: string, token: string): void {
    const answer = this.#heap.add(
      (id): LiveObjectOf<'answer'> => ({
        kind: 'answer',
        id,
        future,
        instance,
        token,
        followed: false,
      }),
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
   * Resolves every pending watch whose condition `holds` says holds, with what it gives; whether
   * any did.
   */
  resolveWatches(holds: (watch: Watch) => Value | undefined): boolean {
    let resolved = false;
    for (const { id, state } of this.#heap.find('pending', 'watch')) {
      const value = state.kind === 'watch' ? holds(state) : undefined;
      if (value !== undefined) {
        this.resolve(id, value);
        resolved = true;
      }
    }
    return resolved;
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
  }

  /**
   * Resolves the future its host named `token` with `value` (§9); false when no future pending on
   * the host has that name.
   */
  resolveHost(token: string, value: Value): boolean {
    const future = this.#hostFuture(token);
    if (future !== undefined) {
      this.resolve(future.id, value);
    }
    return future !== undefined;
  }

  /**
   * A future the host fills later as `token` (§9); a panic when one pending on the host already
   * has that name, since a fill could then reach either.
   */
  createHost(token: string): Value {
    if (this.#hostFuture(token) !== undefined) {
      throw new Panic(`The host named a future '${token}', as one it has yet to fill.`);
    }
    return this.createHandle({ kind: 'host', token });
  }

  /**
   * A future another instance fills, as a host does, its token named by `tokenOf` from the
   * future's own id: its id and the token.
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

  /** Resolves every timer due at `now`, earliest first. */
  resolveDueTimers(now: bigint): void {
    const due = this.#heap
      .find('pending', 'timer')
      .flatMap(({ id, state }) =>
        state.kind === 'timer' && state.at <= now ? [{ id, ...state }] : [],
      )
      .sort((first, second) =>
        first.at === second.at ? first.id - second.id : Number(first.at - second.at),
      );
    for (const { id } of due) {
      this.resolve(id, null);
    }
  }

  /** A handle to a future of the first of `handles` to resolve (spec §3.8, `futures.first`). */
  first(handles: readonly Value[]): Value {
    if (handles.length === 0) {
      throw new Panic('futures.first was given no futures.');
    }
    for (const [position, handle] of handles.entries()) {
      const settled = this.settled(handle);
      if (settled !== undefined) {
        return this.createHandle({ kind: 'resolved', value: positioned(position, settled.value) });
      }
    }
    return this.createHandle({ kind: 'first', futures: handles.map(handleObject) });
  }

  #future(handle: Value): LiveObjectOf<'future'> {
    return this.#heap.of(handleObject(handle), 'future');
  }

  #pendingFirsts(): readonly FirstFuture[] {
    return this.#heap.find('pending', 'first').filter(isFirst);
  }
}

/** What a `first` resolves with: the winner's position and value, as an `(Int, T)`. */
function positioned(position: number, value: Value): Value {
  return { kind: 'tuple', elements: [BigInt(position), value] };
}

function isFirst(future: LiveObjectOf<'future'>): future is FirstFuture {
  return future.state.kind === 'first';
}

/** The futures `execution`'s top frame waits on, in the order its `await` or `select` names them. */
export function waitedOn(execution: LiveExecution): readonly number[] {
  const frame = execution.frames.at(-1);
  const instruction = frame?.code.instructions[frame.pc];
  if (frame === undefined || instruction === undefined) {
    return [];
  }
  return awaitedRegisters(instruction).flatMap((register) => {
    const target = handleTarget(readRegister(frame, register));
    return target === undefined ? [] : [target];
  });
}
