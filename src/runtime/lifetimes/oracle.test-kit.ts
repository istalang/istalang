/**
 * The oracle of static lifetimes (docs/work/static-lifetimes/design.md §1, §9.2): no cycle of what
 * the heap holds passes through an object that reaches a disposable, so counting holders would
 * dispose everything tracing does. Test runtimes check it after every instruction that let go of
 * or wrote into something (`HeapCheck`), over what those objects reach. Only a write into one of
 * its objects closes a cycle (design.md §2), and one lost to counting is one that something let go
 * of, so each is seen while it is still there, even one let go of in the step that made it.
 *
 * - The graph is the heap's holding (`Heap.holds`, and an execution's frames), with two changes.
 *   A call's future holds its call (spec §7), an edge the runtime keeps as a root instead. A wait's
 *   case's chain is no object of its own (design.md §3): the wait holding its resolvers, each
 *   holding what decides it and the futures it is registered on, ends with the wait whatever holds
 *   what. So the wait holds the futures its chain is registered on, what its waiter awaits, and a
 *   resolver of it holds only its `onCancel` callbacks.
 * - It stays in the test runtime for good, the ground truth for the analysis's soundness and for
 *   lowering agreeing with it, so it reads the runtime's own disposability (disposal.ts).
 */

import { handlesIn } from '../../definition/values/values.ts';
import { addToGroup } from '../../foundation/structures/groups.ts';
import { pushAll } from '../../foundation/structures/stack.ts';
import { stronglyConnected } from '../../foundation/structures/strongly-connected.ts';
import type { Heap, LiveObject, LiveObjectOf } from '../scheduler/instance/heap.ts';
import type { HeapCheck } from '../scheduler/loaded-definition.ts';
import {
  frameCells,
  frameValues,
  heldObjects,
  isHeldFromRoot,
  valuesIn,
} from '../snapshot/holdings.ts';
import { type Disposability, isDisposable } from './disposal.ts';

/**
 * The objects of each cycle through objects reaching a disposable that `changed` reaches, by id,
 * each in id order.
 */
function disposableCycles(
  state: Disposability,
  changed: Iterable<number>,
): readonly (readonly number[])[] {
  const successors = countedGraph(state.heap, changed);
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
  return [...cycles.values()];
}

/** A check that throws at the first cycle through objects reaching a disposable, naming them. */
const acyclicDisposables: HeapCheck = (state, changed) => {
  const [cycle] = disposableCycles(state, changed);
  if (cycle !== undefined) {
    const named = cycle.map((id) => `${id}:${state.heap.objectOf(id).kind}`).join(', ');
    throw new Error(`A cycle reaching a disposable holds objects ${named}.`);
  }
};

/** How a program's heaps are checked, and whether what the check saw was what it expected. */
export interface Oracle {
  readonly heapCheck: HeapCheck;
  readonly asExpected: () => boolean;
}

/** The oracle of a program making no cycle reaching a disposable: it throws at the first. */
export const acyclicOracle: Oracle = { heapCheck: acyclicDisposables, asExpected: () => true };

/**
 * What makes a cycle reaching a disposable, by name: corpus programs (test/corpus/programs.ts),
 * which C3 turns into invalid cases, and std modules whose suites do, `collections` by `WeakMap`,
 * which C3 rewrites (docs/work/static-lifetimes/design.md §10).
 */
const cyclic: ReadonlySet<string> = new Set(['holders/dispose.ista', 'collections']);

/**
 * The oracle for a program that makes a cycle reaching a disposable, which C3 rejects: it records
 * the cycles rather than throwing, and expects to have seen one.
 */
export function cyclicOracle(): Oracle {
  let seen = false;
  return {
    heapCheck: (state, changed) => {
      seen ||= disposableCycles(state, changed).length > 0;
    },
    asExpected: () => seen,
  };
}

/**
 * The oracle for the corpus program or std module `name`: a cyclic one's for one known to make a
 * cycle, else the one throwing at a cycle.
 */
export function oracleFor(name: string): Oracle {
  return cyclic.has(name) ? cyclicOracle() : acyclicOracle;
}

/** What `from` reaches in the oracle's graph: what each object of it holds there, by id. */
function countedGraph(heap: Heap, from: Iterable<number>): ReadonlyMap<number, readonly number[]> {
  const successors = new Map<number, readonly number[]>();
  const queue = [...from];
  for (const id of queue) {
    if (!successors.has(id) && heap.has(id)) {
      const held = countedHolds(heap, heap.objectOf(id)).filter((to) => heap.has(to));
      successors.set(id, held);
      pushAll(queue, held);
    }
  }
  return successors;
}

/** What `object` holds in the oracle's graph (see the header). */
function countedHolds(heap: Heap, object: LiveObject): readonly number[] {
  if (object.kind === 'execution') {
    return object.frames.flatMap((frame) => [
      ...frameCells(frame),
      ...frameValues(frame).flatMap(handlesIn),
    ]);
  }
  if (object.kind === 'wait') {
    return [...heldObjects(object), ...awaitedFutures(heap, object)];
  }
  if (
    object.kind === 'resolver' &&
    object.state.kind === 'pending' &&
    isHeldFromRoot(object.state.target)
  ) {
    return valuesIn(object).flatMap(handlesIn);
  }
  const held = heap.holds(object);
  return object.kind === 'future'
    ? [...held, ...heap.find('executions', object.id).map((execution) => execution.id)]
    : held;
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
    [...successors.keys()].filter((id) => isDisposable(state, state.heap.objectOf(id))),
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
