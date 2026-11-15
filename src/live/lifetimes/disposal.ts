/**
 * What disposing each kind of counted object of a run of compiled code does (spec §7's table), as
 * the interpreter's (runtime/lifetimes/disposal.ts) says it for its heap.
 *
 * - A future first cancels the resolvers still registered on it, which it can no longer resolve,
 *   and tells its host, for one a host resolves. An async call's future then disposes the call: the
 *   call, suspended (a running call holds its own future), resumes at the case of its wait on its
 *   own `disposing()` watch, if it waits on one, and stops at its next wait; else it stops where it
 *   waits, its frame letting go of what it held.
 * - A cell or resource whose type declares `dispose` as code calls it.
 * - A wait let go of with cases pending withdraws them, and a pending resolver let go of is
 *   cancelled, its `onCancel` callbacks readied; one an awaitable dropped while its wait is still
 *   awaited panics (proposal 8, Rule 5).
 * - Anything else, such as a resolved future or a timer nothing awaits, is simply gone.
 */

import { disposalOf, type TypeDefinition } from '../../definition/tables/types.ts';
import type { Value } from '../../definition/values/values.ts';
import { Panic } from '../../runtime/natives.ts';
import { Cell } from '../values/cell.ts';
import { Resource } from '../values/resource.ts';
import { Future } from '../waits/future.ts';
import type { Resolver } from '../waits/resolver.ts';
import { Wait } from '../waits/wait.ts';
import type { Counted, WaitIndexes } from './holdings.ts';

/** Code a disposal runs: a declared `dispose` called with the value, or a disposed call's cleanup. */
export type Disposal<Execution> =
  | { readonly kind: 'call'; readonly function: number; readonly argument: Value }
  | { readonly kind: 'cleanup'; readonly execution: Execution; readonly position: number };

/** What disposing reaches beyond the object. */
export interface DisposalContext<Execution> extends WaitIndexes {
  readonly types: readonly TypeDefinition[];
  /** The suspended call future `call` is of, while it may be disposed. */
  readonly callOf: (call: Future) => Execution | undefined;
  /** The case of the wait `execution` is stopped at that waits on its own `disposing()` watch. */
  readonly cleanupCase: (execution: Execution) => number | undefined;
  /** Stops the suspended `execution` where it waits, letting go of what its frame holds. */
  readonly stop: (execution: Execution) => void;
  /** The call of future `call` is being disposed: its `disposing()` watches resolve. */
  readonly disposing: (call: Future) => void;
  /** Tells the host resolving future `future`, if one does, that it was disposed unresolved. */
  readonly hostDisposed: (future: Future) => void;
  /** Cancels the pending `resolver`, readying its `onCancel` callbacks. */
  readonly cancel: (resolver: Resolver) => void;
  /** Whether `wait` still has a waiter waiting on it (`isAwaited`). */
  readonly isAwaited: (wait: Wait) => boolean;
}

/** Whether `object` reaching zero holders runs its disposal, rather than only being gone. */
export function isDisposable<Execution>(
  context: DisposalContext<Execution>,
  object: Counted,
): boolean {
  if (object instanceof Cell || object instanceof Resource) {
    return disposalOf(context.types, object.type).kind !== 'none';
  }
  if (object instanceof Future) {
    return (
      (object.settled === undefined &&
        ((object.origin === 'call' && context.callOf(object) !== undefined) ||
          object.origin === 'host')) ||
      pending(context.registeredOn(object)).length > 0
    );
  }
  if (object instanceof Wait) {
    return pending(context.casesOf(object)).length > 0;
  }
  return object.state === 'pending';
}

/** Disposes `object` its own way: the code to run, for a disposal that runs code. */
export function dispose<Execution>(
  context: DisposalContext<Execution>,
  object: Counted,
): Disposal<Execution> | undefined {
  if (object instanceof Cell || object instanceof Resource) {
    const disposal = disposalOf(context.types, object.type);
    return disposal.kind === 'function'
      ? { kind: 'call', function: disposal.function, argument: object }
      : undefined;
  }
  if (object instanceof Future) {
    return disposeFuture(context, object);
  }
  if (object instanceof Wait) {
    for (const resolver of pending(context.casesOf(object))) {
      context.cancel(resolver);
    }
    return undefined;
  }
  if (object.state === 'pending') {
    if (isDropped(context, object)) {
      throw new Panic(
        'A resolver was let go of unresolved, so the wait it was to decide never can. An ' +
          'awaitable keeps the work it starts alive by registering its resolver, or a ' +
          'Resolver.at of it, on that work; to map a value, await it in an async fn.',
      );
    }
    context.cancel(object);
  }
  return undefined;
}

function disposeFuture<Execution>(
  context: DisposalContext<Execution>,
  future: Future,
): Disposal<Execution> | undefined {
  for (const resolver of pending(context.registeredOn(future))) {
    context.cancel(resolver);
  }
  context.hostDisposed(future);
  const execution = future.origin === 'call' ? context.callOf(future) : undefined;
  if (execution === undefined) {
    return undefined;
  }
  // Its case is found before the watches resolve, which settles the resolvers it is found by.
  const position = context.cleanupCase(execution);
  context.disposing(future);
  if (position !== undefined) {
    return { kind: 'cleanup', execution, position };
  }
  context.stop(execution);
  return undefined;
}

/** Whether `resolver`, let go of while pending, is a wait's an awaitable dropped. */
function isDropped<Execution>(context: DisposalContext<Execution>, resolver: Resolver): boolean {
  const { target } = resolver;
  return target.kind === 'case' && resolver.on.length === 0 && context.isAwaited(target.wait);
}

function pending(resolvers: readonly Resolver[]): readonly Resolver[] {
  return resolvers.filter((resolver) => resolver.state === 'pending');
}
