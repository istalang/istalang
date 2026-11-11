/**
 * The resolver of a live future something outside the run resolves (proposal 8, Rules 5 and 9): a
 * host's extern, by hand or through the promise it gave. It extends a live wait's one-shot resume
 * (waiting.ts), so resolving it, from anywhere, only queues the value for the run's next segment.
 *
 * - It takes one value: `tryResolve` says whether it took it, for races, and a resolver that took a
 *   value, failed or was cancelled takes nothing more.
 * - Failing it panics its run with the trace of where its future was made, as a promise's
 *   rejection does; so does misusing it (`panic`), whatever it stands at, such as a second
 *   `resolve`.
 * - Once its future is disposed unresolved, it is cancelled: each `onCancel` callback is called
 *   once, at once, since a live wait's cancellation commits nothing (§7). A callback that throws
 *   panics the run, as a host's bug does.
 * - Its future is filled through a token no host names, so the run's futures say whether it still
 *   waits (futures.ts): a value queued for a future disposed meanwhile is dropped.
 */

import { handleTo, type Value } from '../../definition/values/values.ts';
import { Panic, type Resolvable, type ResolverState } from '../natives.ts';
import type { Instance } from './instance/index.ts';
import type { FailedWait, LiveResumes, Resume } from './waiting.ts';

class LiveResolver {
  #state: ResolverState = 'pending';
  readonly #cancels: (() => void)[] = [];
  readonly #settle: Resume<PromiseSettledResult<Value>>;
  readonly #misused: (failed: FailedWait) => void;
  readonly #trace: string;

  constructor(
    settle: Resume<PromiseSettledResult<Value>>,
    misused: (failed: FailedWait) => void,
    trace: string,
  ) {
    this.#settle = settle;
    this.#misused = misused;
    this.#trace = trace;
  }

  get state(): ResolverState {
    return this.#state;
  }

  tryResolve(value: Value): boolean {
    if (this.#state !== 'pending') {
      return false;
    }
    this.#state = 'resolved';
    this.#settle({ status: 'fulfilled', value });
    return true;
  }

  fail(panic: Panic): void {
    if (this.#state === 'pending') {
      this.#state = 'resolved';
      this.#settle({ status: 'rejected', reason: panic });
    }
  }

  panic(panic: Panic): void {
    this.#misused({ message: panic.message, trace: this.#trace });
  }

  onCancel(callback: () => void): void {
    if (this.#state === 'cancelled') {
      cancelling(callback);
      return;
    }
    this.#cancels.push(callback);
  }

  /** Its future was disposed: unless it took a value, it is cancelled. */
  cancel(): void {
    if (this.#state !== 'pending') {
      return;
    }
    this.#state = 'cancelled';
    for (const callback of this.#cancels.splice(0)) {
      cancelling(callback);
    }
  }
}

/** Calls `callback`, an `onCancel`'s; a throw panics the run. */
function cancelling(callback: () => void): void {
  try {
    callback();
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Panic(`A host's onCancel threw: ${why}`, { cause: error });
  }
}

/**
 * A new live future of `futures` and its resolver, in a live run resumed through `resumes`;
 * `trace` is where the future was made, where a failed wait panics.
 */
export function liveResolvable(
  { futures, notices }: Pick<Instance, 'futures' | 'notices'>,
  resumes: LiveResumes,
  trace: string,
): Resolvable {
  const { id, token } = futures.createFilled(String);
  const settle = resumes.once((settled: PromiseSettledResult<Value>) => {
    if (settled.status === 'fulfilled') {
      futures.resolveHost(token, settled.value);
      return;
    }
    if (!futures.waitsOnHost(token)) {
      return;
    }
    if (!(settled.reason instanceof Panic)) {
      throw settled.reason;
    }
    return { message: settled.reason.message, trace };
  });
  const resolver = new LiveResolver(settle, (failed) => resumes.fail(failed), trace);
  notices.onDisposed(id, () => {
    resolver.cancel();
  });
  return { future: handleTo(id), resolver };
}
