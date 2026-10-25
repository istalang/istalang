/**
 * What disposing each kind of object does (spec §7's table): one entry per kind, saying whether
 * such an object is disposed when nothing holds it, rather than simply left out of the next commit, and how.
 *
 * - A future of an async call stops the call: it can only be suspended, since a running execution
 *   holds its own future (holders.ts), and it is stopped where it waits, its frames let go.
 * - A pending slot operation leaves its slot's queue without consuming anything; a timer is simply
 *   gone, and so is a future the host fills, whose later fill then changes nothing.
 * - A slot dies with the value in it; nothing waits on it, since a waiting operation holds it.
 * - A `defer` guard calls its function, and a value whose type declares `dispose` as code calls
 *   that: both are calls the collector runs as code (collector.ts), and the object is gone once the
 *   call returns. A disposal never awaits, since neither can.
 * Disposability comes from an object's kind, or for a cell or resource from its type entry, never
 * from a flag of its own (snapshot/objects.ts).
 */

import type { FunctionId } from '../../definition/operands.ts';
import type { TypeDefinition } from '../../definition/types.ts';
import type { Value } from '../../definition/values.ts';
import type { Heap, LiveExecution, LiveKind, LiveObject, LiveObjectOf } from '../scheduler/heap.ts';

/** A call a disposal makes: a function value, or a function with its arguments. */
export interface DisposalCall {
  readonly function: FunctionId;
  readonly captures: readonly Value[];
  readonly arguments: readonly Value[];
}

/** What disposing reaches besides the object: the heap, and the executions it stops. */
export interface DisposalContext {
  readonly heap: Heap;
  readonly types: readonly TypeDefinition[];
  /** Stops a suspended execution where it waits, letting go of everything its frames hold. */
  readonly stop: (execution: LiveExecution) => void;
}

/** How one kind of object is disposed. */
interface KindDisposal<Object extends LiveObject> {
  /** Whether such an object is disposed when nothing holds it, rather than simply left out of the next commit. */
  readonly disposable: (types: readonly TypeDefinition[], object: Object) => boolean;
  /** Disposes it its own way: the call to make, for a disposal that runs code. */
  readonly dispose: (context: DisposalContext, object: Object) => DisposalCall | undefined;
}

const always = (): boolean => true;
const never = (): boolean => false;
const nothing = (): undefined => undefined;

/** A kind disposed through its type entry's `disposal`: a cell, or a resource. */
const declared: KindDisposal<LiveObjectOf<'cell' | 'resource'>> = {
  disposable: (types, object) => disposalOf(types, object.type).kind !== 'none',
  dispose: (context, object) => {
    const disposal = disposalOf(context.types, object.type);
    return disposal.kind === 'function'
      ? {
          function: disposal.function,
          captures: [],
          arguments: [{ kind: 'handle', object: object.id }],
        }
      : undefined;
  },
};

const kinds: { readonly [Kind in LiveKind]: KindDisposal<LiveObjectOf<Kind>> } = {
  future: { disposable: always, dispose: disposeFuture },
  slot: { disposable: always, dispose: nothing },
  mock: { disposable: always, dispose: nothing },
  guard: { disposable: always, dispose: (_context, guard) => callOf(guard.callback) },
  cell: declared,
  resource: declared,
  weakRef: { disposable: never, dispose: nothing },
  execution: { disposable: never, dispose: nothing },
};

/** Whether `object` is disposed when nothing holds it any more, rather than simply left out of the next commit. */
export function isDisposable(types: readonly TypeDefinition[], object: LiveObject): boolean {
  return entryOf(object).disposable(types, object);
}

/**
 * Disposes `object` its own way: the call to make, for a disposal that runs code. The object itself
 * is removed by the caller, once that call has returned.
 */
export function dispose(context: DisposalContext, object: LiveObject): DisposalCall | undefined {
  return entryOf(object).dispose(context, object);
}

/** The entry of `object`'s kind, typed for the object as its union sees it. */
function entryOf(object: LiveObject): KindDisposal<LiveObject> {
  return kinds[object.kind] as KindDisposal<LiveObject>;
}

/** A call's future stops its call; a pending slot operation leaves its slot's queue. */
function disposeFuture(context: DisposalContext, future: LiveObjectOf<'future'>): undefined {
  const { state } = future;
  if (state.kind === 'call') {
    const execution = context.heap
      .objectsOf('execution')
      .find((candidate) => candidate.resolves === future.id);
    if (execution !== undefined) {
      context.stop(execution);
    }
  } else if (state.kind === 'slot' && context.heap.has(state.slot)) {
    const slot = context.heap.of(state.slot, 'slot');
    context.heap.replace({ ...slot, waiting: slot.waiting.filter((id) => id !== future.id) });
  }
}

/** The call a function value makes when called with no arguments. */
function callOf(callback: Value): DisposalCall {
  if (callback === null || typeof callback !== 'object' || callback.kind !== 'closure') {
    throw new TypeError('A defer guard holds no function; the checker forbids it.');
  }
  return { function: callback.function, captures: callback.captures, arguments: [] };
}

function disposalOf(types: readonly TypeDefinition[], type: number) {
  const entry = types[type];
  return entry?.kind === 'extern' ? entry.disposal : { kind: 'none' as const };
}
