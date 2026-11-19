/**
 * The ready queue (§15.1): what runs next, one at a time, in the order it was readied.
 *
 * - A **resume** unparks an execution with its wait's decision. An execution is readied once: a
 *   decision taken anew as its call is disposed replaces the first, keeping its place.
 * - A **call** runs a closure readied as a call of its own (a `Resolver.of` callback, an
 *   `onCancel`).
 * - An **invoke** starts a call into the instance (§17.1), with what the caller passed. Its answer is
 *   the caller's, which no snapshot keeps, so an instance commits only once none waits: one made
 *   after a call parked starts before that segment commits (`nextInvocation`).
 */

import type { Value } from '../../definition/values/values.ts';
import type { Invocation } from './invocations.ts';
import type { Execution } from './objects/execution.ts';

export type Ready =
  | { readonly kind: 'resume'; readonly execution: Execution; readonly decision: unknown }
  | { readonly kind: 'call'; readonly closure: Value; readonly arguments: readonly Value[] }
  | {
      readonly kind: 'invoke';
      readonly closure: Value;
      readonly arguments: readonly Value[];
      readonly invocation: Invocation;
    };

/** What a snapshot keeps of the queue, in order: resumes of parked calls and readied callbacks. */
export type PersistedReady =
  | { readonly execution: Execution; readonly decision: Value }
  | { readonly call: Value; readonly arguments: readonly Value[] };

export class ReadyQueue {
  readonly #items: Ready[] = [];

  /** Readies `execution` to resume with `decision`, where it was readied first if it was. */
  resume(execution: Execution, decision: unknown): void {
    const at = this.#resumeOf(execution);
    const ready: Ready = { kind: 'resume', execution, decision };
    if (at < 0) {
      this.#items.push(ready);
    } else {
      this.#items[at] = ready;
    }
  }

  /** Takes back the resume readied for `execution`, if any. */
  unready(execution: Execution): void {
    const at = this.#resumeOf(execution);
    if (at >= 0) {
      this.#items.splice(at, 1);
    }
  }

  call(closure: Value, passed: readonly Value[]): void {
    this.#items.push({ kind: 'call', closure, arguments: passed });
  }

  invoke(closure: Value, passed: readonly Value[], invocation: Invocation): void {
    this.#items.push({ kind: 'invoke', closure, arguments: passed, invocation });
  }

  /** What runs next, taken out of the queue. */
  next(): Ready | undefined {
    return this.#items.shift();
  }

  get empty(): boolean {
    return this.#items.length === 0;
  }

  /** The first invocation waiting to start, taken out of the queue. */
  nextInvocation(): Ready | undefined {
    const at = this.#items.findIndex((ready) => ready.kind === 'invoke');
    return at < 0 ? undefined : this.#items.splice(at, 1)[0];
  }

  /** Whether an invocation waits to start. */
  get invoking(): boolean {
    return this.#items.some((ready) => ready.kind === 'invoke');
  }

  /** Empties the queue as the run finishes; what its readied calls were to be called with. */
  dropped(): Value[] {
    return this.#items
      .splice(0)
      .flatMap((ready) => (ready.kind === 'call' ? [ready.closure, ...ready.arguments] : []));
  }

  persisted(): PersistedReady[] {
    return this.#items.flatMap((ready): PersistedReady[] => {
      switch (ready.kind) {
        case 'resume':
          return [{ execution: ready.execution, decision: ready.decision as Value }];
        case 'call':
          return [{ call: ready.closure, arguments: ready.arguments }];
        case 'invoke':
          return [];
        default: {
          const unhandled: never = ready;
          return unhandled;
        }
      }
    });
  }

  restore(ready: readonly PersistedReady[]): void {
    for (const each of ready) {
      this.#items.push(
        'execution' in each
          ? { kind: 'resume', execution: each.execution, decision: each.decision }
          : { kind: 'call', closure: each.call, arguments: each.arguments },
      );
    }
  }

  #resumeOf(execution: Execution): number {
    return this.#items.findIndex(
      (ready) => ready.kind === 'resume' && ready.execution === execution,
    );
  }
}
