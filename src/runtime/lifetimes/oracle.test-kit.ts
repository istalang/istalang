/**
 * The oracle of static lifetimes (docs/work/static-lifetimes/design.md §1, §9.2): no cycle of what
 * the heap holds passes through an object that reaches a disposable, so counting holders would
 * dispose everything tracing does. Test runtimes check it after every instruction that let go of
 * or wrote into something (`HeapCheck`), over what those objects reach. Only a write into one of
 * its objects closes a cycle (design.md §2), and one lost to counting is one that something let go
 * of, so each is seen while it is still there, even one let go of in the step that made it.
 *
 * - The graph is what the analysis has hold, so an accepted program never trips it (design.md §3,
 *   §6.3, §6.4): the heap's holding (`Heap.holds`, and an execution's frames), but where they part.
 *   A call's future holds its call (spec §7), which the runtime keeps as a root instead, but while
 *   the call runs: then it is a root, and what its frames hold only for the moment it runs is
 *   no cycle, as the analysis's call reach is what they hold at an `await` (design.md §5.3). A future
 *   holds every resolver registered on it, as `onAwait` keeps one. A resolver holds its callbacks
 *   and the resolver it decides, never its futures or the resolvers deciding it: a wait's case's
 *   chain is no object of its own, and ends with its wait whatever holds what. A wait holds what
 *   its chain is registered on, what its waiter awaits.
 * - A disposable is the language's (spec §7): a pending future or resolver, a slot, a value whose
 *   type declares `dispose`, and a mock, whether or not the runtime must do something at once when
 *   it loses its last holder (disposal.ts `isDisposable`). Counting is for the former.
 * - It stays in the test runtime for good, the ground truth for the analysis's soundness and for
 *   lowering agreeing with it.
 */

import { handlesIn } from '../../definition/values/values.ts';
import { addToGroup } from '../../foundation/structures/groups.ts';
import { type Handlers, handlerOf } from '../../foundation/structures/kind-table.ts';
import { pushAll } from '../../foundation/structures/stack.ts';
import { stronglyConnected } from '../../foundation/structures/strongly-connected.ts';
import type { Heap, LiveObject, LiveObjectOf } from '../scheduler/instance/heap.ts';
import { type HeapCheck, noHeapCheck } from '../scheduler/loaded-definition.ts';
import { frameCells, frameValues, heldObjects, valuesIn } from '../snapshot/holdings.ts';
import { type Disposability, isDisposable } from './disposal.ts';

/**
 * The objects of each cycle through objects reaching a disposable that `changed` reaches, by id,
 * each in id order.
 */
function disposableCycles(
  state: Disposability,
  changed: Iterable<number>,
  running: ReadonlySet<number>,
): readonly (readonly number[])[] {
  const successors = countedGraph(
    state.heap,
    [...changed].flatMap((id) => touched(state.heap, id)),
    running,
  );
  const componentOf = stronglyConnected(
    [...successors].flatMap(([from, tos]) => tos.map((to) => ({ from, to }))),
  );
  const reaching = reachingDisposables(state, successors);
  const cycles = new Map<number, number[]>();
  for (const [id, tos] of successors) {
    const component = componentOf(id);
    if (
      component !== undefined &&
      reaching.has(id) &&
      tos.some((to) => componentOf(to) === component)
    ) {
      addToGroup(cycles, component, id);
    }
  }
  return [...cycles.values()].map((cycle) => cycle.toSorted((first, second) => first - second));
}

/** The oracle: a check that throws at the first cycle through objects reaching a disposable, naming them. */
export const oracle: HeapCheck = {
  ...noHeapCheck,
  changed: (state, changed, running) => {
    const [cycle] = disposableCycles(state, changed, running);
    if (cycle !== undefined) {
      const named = cycle.map((id) => `${id}:${state.heap.objectOf(id).kind}`).join(', ');
      throw new Error(`A cycle reaching a disposable holds objects ${named}.`);
    }
  },
};

/**
 * A check recording whether it saw a cycle the oracle throws at, for the oracle's own tests, whose
 * programs make them (oracle.test.ts).
 */
export function cycleWatch(): { readonly heapCheck: HeapCheck; readonly seen: () => boolean } {
  let seen = false;
  return {
    heapCheck: {
      ...noHeapCheck,
      changed: (state, changed, running) => {
        seen ||= disposableCycles(state, changed, running).length > 0;
      },
    },
    seen: () => seen,
  };
}

/**
 * The objects whose edges in the oracle's graph changing `id` may have changed: itself, and a
 * pending resolver's futures, whose edges to it registering it adds, as to them its wait's.
 */
function touched(heap: Heap, id: number): readonly number[] {
  const object = heap.has(id) ? heap.objectOf(id) : undefined;
  return object?.kind === 'resolver' && object.state.kind === 'pending'
    ? [id, ...object.state.on]
    : [id];
}

/** What `from` reaches in the oracle's graph: what each object of it holds there, by id. */
function countedGraph(
  heap: Heap,
  from: Iterable<number>,
  running: ReadonlySet<number>,
): ReadonlyMap<number, readonly number[]> {
  const successors = new Map<number, readonly number[]>();
  const queue = [...from];
  for (const id of queue) {
    if (!successors.has(id) && heap.has(id)) {
      const held = countedHolds(heap, heap.objectOf(id), running).filter((to) => heap.has(to));
      successors.set(id, held);
      pushAll(queue, held);
    }
  }
  return successors;
}

/** What `object` holds in the oracle's graph (see the header). */
export function countedHolds(
  heap: Heap,
  object: LiveObject,
  running: ReadonlySet<number> = new Set(),
): readonly number[] {
  if (object.kind === 'execution') {
    return object.frames.flatMap((frame) => [
      ...frameCells(frame),
      ...frameValues(frame).flatMap(handlesIn),
    ]);
  }
  if (object.kind === 'wait') {
    return [...heldObjects(object), ...awaitedFutures(heap, object)];
  }
  if (object.kind === 'resolver') {
    const { state } = object;
    const decides =
      state.kind === 'pending' && state.target.kind === 'at' ? [state.target.done] : [];
    return [...valuesIn(object).flatMap(handlesIn), ...decides];
  }
  if (object.kind === 'future') {
    return [
      ...heldObjects(object),
      ...heap.find('resolvers', object.id).map((resolver) => resolver.id),
      ...heap
        .find('executions', object.id)
        .flatMap((execution) => (running.has(execution.id) ? [] : [execution.id])),
    ];
  }
  return heap.holds(object);
}

/** The futures `wait`'s chain is registered on: what its waiter awaits. */
function awaitedFutures(heap: Heap, wait: LiveObjectOf<'wait'>): readonly number[] {
  const futures: number[] = [];
  const chain = [...heap.find('cases', wait.id)];
  for (const resolver of chain) {
    if (resolver.state.kind === 'pending') {
      pushAll(futures, resolver.state.on);
      pushAll(chain, heap.find('positions', resolver.id));
    }
  }
  return futures;
}

/** The objects of `successors` reaching a disposable through it, the disposables included. */
function reachingDisposables(
  state: Disposability,
  successors: ReadonlyMap<number, readonly number[]>,
): ReadonlySet<number> {
  const predecessors = new Map<number, number[]>();
  for (const [from, tos] of successors) {
    for (const to of tos) {
      addToGroup(predecessors, to, from);
    }
  }
  const reaching = new Set(
    [...successors.keys()].filter((id) => {
      const object = state.heap.objectOf(id);
      return handlerOf(disposables, object)(state, object);
    }),
  );
  const queue = [...reaching];
  for (const id of queue) {
    for (const from of predecessors.get(id) ?? []) {
      if (!reaching.has(from)) {
        reaching.add(from);
        queue.push(from);
      }
    }
  }
  return reaching;
}

/** Whether an object of each kind is a disposable as the language has it (see the header). */
const disposables: Handlers<Disposability, LiveObject, [], boolean> = {
  future: (_state, { state }) => state.kind !== 'resolved',
  resolver: (_state, { state }) => state.kind === 'pending',
  slot: () => true,
  cell: (state, cell) => isDisposable(state, cell),
  resource: (state, resource) => isDisposable(state, resource),
  mock: () => true,
  weakRef: () => false,
  answer: () => false,
  outcome: () => false,
  wait: () => false,
  run: () => false,
  contextConstant: () => false,
  execution: () => false,
};
