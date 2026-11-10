/**
 * What disposing each kind of object does (spec §7's table): one entry per kind, saying whether
 * such an object is disposed when nothing holds it, rather than simply left out of the next commit, and how.
 *
 * - A future of an async call disposes the call: it can only be suspended, since a running
 *   execution holds its own future (holders.ts). Its `disposing()` watches resolve, and a call
 *   waiting on one of them runs its cleanup, resuming on that watcher and stopped at its next
 *   await; any other is stopped where it waits, its frames let go.
 * - A pending slot operation leaves its slot's queue without consuming anything, and a future the
 *   host fills frees its token, so a later fill changes nothing and the host may name a new one so.
 * - A value whose type declares `dispose` as code calls that: a call the collector runs as code
 *   (collector.ts), and the object is gone once the call returns. A disposal never awaits, since a
 *   `dispose` can't.
 * - Any object a weak reference refers to has its watches resolved once it is gone (weak-side.ts).
 *
 * An object is disposed when nothing holds it only when that can be seen: it does one of the
 * above. Any other, such as a resolved future, a timer, a `first` or a slot that no weak reference
 * refers to, is simply left out of the next commit, as a plain value is. What it holds is let go of
 * all the same, since holding is reachability (holders.ts), so a disposable among it is disposed
 * when it would have been; only nothing has to prove the object itself unheld, which costs a walk
 * of the instance's live state. Disposability comes from an object's kind and state, its type entry
 * for a cell or resource, and the weak references in the heap, never from a flag of its own
 * (snapshot/objects.ts).
 */

import type { FunctionId } from '../../definition/operands.ts';
import type { TypeDefinition } from '../../definition/tables/types.ts';
import { handleTo, type Value } from '../../definition/values/values.ts';
import { type Handlers, handlerOf } from '../../foundation/structures/kind-table.ts';
import type { Heap, LiveExecution, LiveObject, LiveObjectOf } from '../scheduler/instance/heap.ts';
import type { WeakSide } from '../scheduler/instance/weak-side.ts';
import type { FutureState } from '../snapshot/objects.ts';

/** A call a disposal makes: a declared `dispose`, with the disposed value as its argument. */
export interface DisposalCall {
  readonly kind: 'call';
  readonly function: FunctionId;
  readonly arguments: readonly Value[];
}

/** A disposed call's cleanup: `execution` resumes on its `disposing()` watcher `watcher` (§7). */
export interface Cleanup {
  readonly kind: 'cleanup';
  readonly execution: LiveExecution;
  readonly watcher: number;
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
  readonly weak: WeakSide;
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

/** Whether disposing a future in each state does something itself, besides what weak references see. */
const futureStates: { readonly [Kind in FutureState['kind']]: boolean } = {
  call: true,
  slot: true,
  host: true,
  resolved: false,
  timer: false,
  first: false,
  disposed: false,
  watch: false,
};

/** How a cell or resource is disposed through its type entry's `disposal`. */
function declared(object: LiveObjectOf<'cell' | 'resource'>): KindDisposal {
  return {
    disposable: ({ types }) => disposalOf(types, object.type).kind !== 'none',
    dispose: (context) => {
      const disposal = disposalOf(context.types, object.type);
      return disposal.kind === 'function'
        ? {
            kind: 'call',
            function: disposal.function,
            arguments: [handleTo(object.id)],
          }
        : undefined;
    },
  };
}

const kinds: Handlers<undefined, LiveObject, [], KindDisposal> = {
  future: (_context, future) => ({
    disposable: (context) => futureStates[future.state.kind] || watched(context, future),
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
 * Disposes `object` its own way: the code to run, for a disposal that runs code. The object itself
 * is removed by the caller, once that code has finished.
 */
export function dispose(context: DisposalContext, object: LiveObject): DisposalRun | undefined {
  return disposalFor(object).dispose(context);
}

/** A call's future disposes its call; a pending slot operation leaves its slot's queue. */
function disposeFuture(
  context: DisposalContext,
  future: LiveObjectOf<'future'>,
): Cleanup | undefined {
  const { state } = future;
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
  const watcher = context.weak.disposing(execution);
  if (watcher !== undefined) {
    return { kind: 'cleanup', execution, watcher };
  }
  context.stop(execution);
  return undefined;
}

function disposalOf(types: readonly TypeDefinition[], type: number) {
  const entry = types[type];
  return entry?.kind === 'extern' ? entry.disposal : { kind: 'none' as const };
}
