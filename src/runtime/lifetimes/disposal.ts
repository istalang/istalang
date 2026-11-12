/**
 * What disposing each kind of object does (spec §7's table): one entry per kind, saying whether
 * such an object is disposed when nothing holds it, rather than simply left out of the next
 * commit, and how.
 *
 * - A future of an async call disposes the call: it can only be suspended, since a running
 *   execution holds its own future (holders.ts). Its `disposing()` watches resolve, and a call
 *   waiting on one of them runs its cleanup, resuming at that case and stopped at its next await;
 *   any other is stopped where it waits, its frames let go.
 * - A pending slot operation leaves its slot's queue without consuming anything, and a future
 *   filled from outside the instance frees its token, so a later answer to it changes nothing. A
 *   disposed future tells what observes it, such as a live resolver of it (proposal 8, Rule 9).
 * - A future, whatever its state, first cancels the resolvers still registered on it, which it can
 *   no longer resolve (§6): a callback's chain's, which it held, as a case's chain holds its
 *   futures instead (snapshot/holdings.ts).
 * - A value whose type declares `dispose` as code calls that: a call the collector runs as code
 *   (collector.ts), and the object is gone once the call returns. A disposal never awaits, since a
 *   `dispose` can't.
 * - A wait's resolver let go of while pending, never registered, panics its waiter (proposal 8,
 *   Rule 5): an awaitable dropped it, so nothing can decide the wait through it. Any other pending
 *   resolver let go of is cancelled, its `onCancel` callbacks readied: one registered for a wait
 *   goes only once the wait ends, which cancels it first (`Heap.holds`), and a `Resolver.of` or
 *   `Resolver.at` one decides no wait of its own.
 * - Any object a weak reference refers to has its watches resolved once it is gone (weak-side.ts).
 *
 * An object is disposed when nothing holds it only when that can be seen: it does one of the
 * above. Any other, such as a resolved future, a timer nothing is registered on, a run or a slot
 * that no weak reference refers to, is simply left out of the next commit, as a plain value is.
 * What it holds is let go of all the same, since holding is reachability (holders.ts), so a
 * disposable among it is disposed when it would have been; only nothing has to prove the object
 * itself unheld, which costs a walk of the instance's live state. Disposability comes from an
 * object's kind and state, its type entry for a cell or resource, and the weak references and
 * registrations in the heap, never from a flag of its own (snapshot/objects.ts).
 */

import type { FunctionId } from '../../definition/operands.ts';
import type { TypeDefinition } from '../../definition/tables/types.ts';
import { handleTo, type Value } from '../../definition/values/values.ts';
import { type Handlers, handlerOf } from '../../foundation/structures/kind-table.ts';
import { Panic } from '../natives.ts';
import type { Heap, LiveExecution, LiveObject, LiveObjectOf } from '../scheduler/instance/heap.ts';
import type { WeakSide } from '../scheduler/instance/weak-side.ts';
import type { FutureState } from '../snapshot/objects.ts';

/** A call a disposal makes: a declared `dispose`, with the disposed value as its argument. */
export interface DisposalCall {
  readonly kind: 'call';
  readonly function: FunctionId;
  readonly arguments: readonly Value[];
}

/**
 * A disposed call's cleanup: `execution` resumes at case `position` of its wait, the one on its
 * `disposing()` watch (§7).
 */
export interface Cleanup {
  readonly kind: 'cleanup';
  readonly execution: LiveExecution;
  readonly position: number;
}

/** Code a disposal runs, which its round waits on. */
export type DisposalRun = DisposalCall | Cleanup;

/** What deciding whether an object is disposed reads: the heap's weak references, and type entries. */
export interface Disposability {
  readonly heap: Heap;
  readonly types: readonly TypeDefinition[];
}

/** What disposing reaches besides the object: the heap, the executions it stops, weak references. */
export interface DisposalContext extends Disposability {
  /** Stops a suspended execution where it waits, letting go of everything its frames hold. */
  readonly stop: (execution: LiveExecution) => void;
  /**
   * The case of the wait a suspended execution is stopped at that waits on its own call's
   * `disposing()`, by position: where a disposal of that call resumes it (§7).
   */
  readonly cleanupCase: (execution: LiveExecution) => number | undefined;
  readonly weak: WeakSide;
  /** Tells what observes the object `id` that it was disposed (§7). */
  readonly disposed: (id: number) => void;
  /** Cancels a pending resolver, readying its `onCancel` callbacks (proposal 8, Rule 5). */
  readonly cancel: (resolver: LiveObjectOf<'resolver'>) => void;
}

/** How one object is disposed. */
interface KindDisposal {
  /** Whether it is disposed when nothing holds it, rather than simply left out of the next commit. */
  readonly disposable: (context: Disposability) => boolean;
  /** Disposes it its own way: the code to run, for a disposal that runs code. */
  readonly dispose: (context: DisposalContext) => DisposalRun | undefined;
}

const inert: KindDisposal = { disposable: () => false, dispose: () => undefined };

/** Whether a weak reference refers to `object`, whose watches its disposal resolves. */
const watched = (context: Disposability, object: LiveObject): boolean =>
  context.heap.find('weakRefs', object.id).length > 0;

/** Whether a resolver is registered on `future`, which its disposal cancels. */
const registered = (context: Disposability, future: LiveObject): boolean =>
  context.heap.find('resolvers', future.id).length > 0;

/** Whether disposing a future in each state does something itself, besides what weak references see. */
const futureStates: { readonly [Kind in FutureState['kind']]: boolean } = {
  call: true,
  slot: true,
  host: true,
  resolved: false,
  timer: false,
  disposed: false,
  watch: false,
};

/**
 * How a cell or resource is disposed through its type entry's `disposal`: a call of its `dispose`,
 * or the runtime's own, which what observes it from outside the language performs.
 */
function declared(object: LiveObjectOf<'cell' | 'resource'>): KindDisposal {
  return {
    disposable: ({ types }) => disposalOf(types, object.type).kind !== 'none',
    dispose: (context) => {
      const disposal = disposalOf(context.types, object.type);
      if (disposal.kind !== 'function') {
        context.disposed(object.id);
        return;
      }
      return { kind: 'call', function: disposal.function, arguments: [handleTo(object.id)] };
    },
  };
}

const kinds: Handlers<undefined, LiveObject, [], KindDisposal> = {
  future: (_context, future) => ({
    disposable: (context) =>
      futureStates[future.state.kind] || watched(context, future) || registered(context, future),
    dispose: (context) => disposeFuture(context, future),
  }),
  slot: (_context, slot) => ({
    disposable: (context) => watched(context, slot),
    dispose: () => undefined,
  }),
  mock: () => ({ disposable: () => true, dispose: () => undefined }),
  cell: (_context, cell) => declared(cell),
  resource: (_context, resource) => declared(resource),
  weakRef: () => inert,
  answer: () => inert,
  outcome: () => inert,
  wait: () => inert,
  resolver: (_context, resolver) => ({
    disposable: (context) => resolver.state.kind === 'pending' || watched(context, resolver),
    dispose: (context) => {
      if (resolver.state.kind !== 'pending') {
        return;
      }
      if (isDropped(resolver)) {
        throw new Panic(
          'A resolver was let go of unresolved, so the wait it was to decide never can. An ' +
            'awaitable keeps the work it starts alive by registering its resolver, or a ' +
            'Resolver.at of it, on that work; to map a value, await it in an async fn.',
        );
      }
      context.cancel(resolver);
    },
  }),
  run: () => inert,
  contextConstant: () => inert,
  execution: () => inert,
};

function disposalFor(object: LiveObject): KindDisposal {
  return handlerOf(kinds, object)(undefined, object);
}

/** Whether `object` is disposed when nothing holds it any more, rather than simply left out of the next commit. */
export function isDisposable(context: Disposability, object: LiveObject): boolean {
  return disposalFor(object).disposable(context);
}

/**
 * The values the calls disposing `object` readies as runs are made with: a pending resolver's
 * `onCancel` callbacks, unless its disposal panics.
 */
export function readiedBy(object: LiveObject): readonly Value[] {
  return object.kind === 'resolver' && object.state.kind === 'pending' && !isDropped(object)
    ? object.state.onCancel
    : [];
}

/** Whether `resolver`, let go of while pending, is a wait's an awaitable dropped, which panics. */
function isDropped(resolver: LiveObjectOf<'resolver'>): boolean {
  const { state } = resolver;
  return state.kind === 'pending' && state.target.kind === 'case' && state.on.length === 0;
}

/**
 * Disposes `object` its own way: the code to run, for a disposal that runs code. The object itself
 * is removed by the caller, once that code has finished.
 */
export function dispose(context: DisposalContext, object: LiveObject): DisposalRun | undefined {
  return disposalFor(object).dispose(context);
}

/**
 * Cancels the resolvers registered on the future and tells what observes it that it is disposed;
 * then a call's future disposes its call, and a pending slot operation leaves its slot's queue.
 */
function disposeFuture(
  context: DisposalContext,
  future: LiveObjectOf<'future'>,
): Cleanup | undefined {
  for (const resolver of context.heap.find('resolvers', future.id)) {
    context.cancel(resolver);
  }
  const { state } = future;
  context.disposed(future.id);
  if (state.kind === 'call') {
    const [execution] = context.heap.find('executions', future.id);
    return execution === undefined ? undefined : disposeCall(context, execution);
  }
  if (state.kind === 'slot' && context.heap.has(state.slot)) {
    const slot = context.heap.of(state.slot, 'slot');
    context.heap.replace({ ...slot, waiting: slot.waiting.filter((id) => id !== future.id) });
  }
  return undefined;
}

/** The disposed call `execution` runs: its cleanup, if it waits for one, or else it stops. */
function disposeCall(context: DisposalContext, execution: LiveExecution): Cleanup | undefined {
  // Its case is found before the watches resolve, which settles the resolvers it is found by.
  const position = context.cleanupCase(execution);
  context.weak.disposing(execution);
  if (position !== undefined) {
    return { kind: 'cleanup', execution, position };
  }
  context.stop(execution);
  return undefined;
}

function disposalOf(types: readonly TypeDefinition[], type: number) {
  const entry = types[type];
  return entry?.kind === 'extern' ? entry.disposal : { kind: 'none' as const };
}
