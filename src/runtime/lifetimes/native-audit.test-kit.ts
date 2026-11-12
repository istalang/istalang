/**
 * The native audit of static lifetimes (docs/work/static-lifetimes/design.md §6.6): an edge a native
 * adds to what an argument holds must be one its extern's `@Keeps` names, or the `&` default, since
 * that is all the analysis knows of a native's call. A test runtime checks it around every native's
 * call (`HeapCheck.native`), as the oracle checks the heap after every instruction.
 *
 * - An argument's holders are the objects its handles name, or the cell a reference names: a native
 *   writes nowhere else a later read finds its arguments.
 * - The graph is the oracle's (oracle.test-kit.ts), and a slot's waiting puts' values are its own:
 *   `put` keeps its value in the slot whether the slot takes it now or once served, and serving it
 *   later, inside another native's call or none, adds no edge the analysis doesn't know.
 * - An edge counts through what the call made: a slot holding a put made now holds its value. What
 *   it reaches that was there before is attributed to each argument whose value holds it; none is
 *   an edge no argument gave, which nothing covers.
 * - The table is the std's, by extern key, read off the checker (stdlib/natives-kept.test-kit.ts),
 *   since the Definition carries neither annotation.
 */

import { handlesIn, type Value } from '../../definition/values/values.ts';
import { pushAll } from '../../foundation/structures/stack.ts';
import type { Heap } from '../scheduler/instance/heap.ts';
import type { HeapCheck, NativeCallMade } from '../scheduler/loaded-definition.ts';
import { isReference, type RegisterContents } from '../snapshot/objects.ts';
import { countedHolds, type Oracle } from './oracle.test-kit.ts';

/** What the parameter at `holder` keeps of an extern's: the parameters at `kept`. */
interface NativeKept {
  readonly holder: number;
  readonly kept: readonly number[];
}

/** What each extern's parameters keep, by its key. */
export type NativeKeeps = ReadonlyMap<string, readonly NativeKept[]>;

export interface NativeAudit {
  readonly native: HeapCheck['native'];
  /** Each edge a native added that its extern's keeps don't cover, described once. */
  readonly uncovered: () => readonly string[];
}

/** An audit of what natives keep against `keeps`. */
export function nativeAudit(keeps: NativeKeeps): NativeAudit {
  const uncovered = new Set<string>();
  return {
    native: ({ heap }, call) => {
      const holders = call.passed.map((contents, position) =>
        holdersOf(contents, call.values[position]),
      );
      if (holders.every((ids) => ids.length === 0)) {
        return () => undefined;
      }
      const before = new Map(
        holders.flat().flatMap((id) => (heap.has(id) ? [[id, new Set(modelHolds(heap, id))]] : [])),
      );
      const newest = Math.max(-1, ...heap.objects().map((object) => object.id));
      return () => {
        for (const edge of addedEdges(heap, holders, before, newest)) {
          const problem = uncoveredEdge(heap, keeps, call, edge);
          if (problem !== undefined) {
            uncovered.add(problem);
          }
        }
      };
    },
    uncovered: () => [...uncovered],
  };
}

/**
 * What is wrong with `call`'s argument at `holder` having come to hold `target`, unless what its
 * extern keeps covers it: some argument whose value holds `target` must be one it keeps.
 */
function uncoveredEdge(
  heap: Heap,
  keeps: NativeKeeps,
  { key, values }: NativeCallMade,
  { holder, target }: AddedEdge,
): string | undefined {
  const givers = values.flatMap((value, position) =>
    handlesIn(value).includes(target) ? [position] : [],
  );
  const kept = keeps.get(key)?.find((each) => each.holder === holder)?.kept ?? [];
  if (givers.some((position) => kept.includes(position))) {
    return undefined;
  }
  const { kind } = heap.objectOf(target);
  const given = givers.length > 0 ? `argument ${givers.join(', ')} gave` : 'no argument gave';
  return `${key}: argument ${holder} came to hold a ${kind} ${given}`;
}

/** `oracle`, auditing natives' calls with `audit` too. */
export function withNativeAudit(oracle: Oracle, audit: NativeAudit): Oracle {
  return { ...oracle, heapCheck: { ...oracle.heapCheck, native: audit.native } };
}

/** The objects a native may write into through an argument passing `contents`, valued `value`. */
function holdersOf(contents: RegisterContents | undefined, value: Value | undefined): number[] {
  if (contents !== undefined && isReference(contents)) {
    return [contents.cell];
  }
  return value === undefined ? [] : [...handlesIn(value)];
}

/** What `id` holds as the analysis has it: the oracle's edges, and a slot's waiting puts' values. */
function modelHolds(heap: Heap, id: number): readonly number[] {
  const object = heap.objectOf(id);
  const held = countedHolds(heap, object);
  if (object.kind !== 'slot') {
    return held;
  }
  const waiting = object.waiting.flatMap((future) => {
    const operation = heap.has(future) ? heap.objectOf(future) : undefined;
    return operation?.kind === 'future' &&
      operation.state.kind === 'slot' &&
      operation.state.value !== undefined
      ? handlesIn(operation.state.value)
      : [];
  });
  return [...held, ...waiting];
}

/** An edge a native's call added: the argument at `holder` came to hold object `target`. */
interface AddedEdge {
  readonly holder: number;
  readonly target: number;
}

/**
 * The edges added to what the objects `holders` lists, per argument, hold, since they held
 * `before` and `newest` was the newest object.
 */
function addedEdges(
  heap: Heap,
  holders: readonly (readonly number[])[],
  before: ReadonlyMap<number, ReadonlySet<number>>,
  newest: number,
): AddedEdge[] {
  return holders.flatMap((ids, holder) =>
    ids.flatMap((id) =>
      added(heap, id, before.get(id) ?? new Set(), newest).map((target) => ({ holder, target })),
    ),
  );
}

/**
 * What `id` holds now that it didn't, `before`, among objects there then: those past `newest` were
 * made since, so what they hold counts as `id`'s own.
 */
function added(heap: Heap, id: number, before: ReadonlySet<number>, newest: number): number[] {
  if (!heap.has(id)) {
    return [];
  }
  const found: number[] = [];
  const seen = new Set<number>();
  const queue = [...modelHolds(heap, id)];
  for (const target of queue) {
    if (!seen.has(target) && heap.has(target)) {
      seen.add(target);
      if (target > newest) {
        pushAll(queue, modelHolds(heap, target));
      } else if (!before.has(target)) {
        found.push(target);
      }
    }
  }
  return found;
}
