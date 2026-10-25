/**
 * Which heap objects are held (spec §7): reachable from a root through what objects hold.
 *
 * Holders are decided by reachability, never counted. Nothing keeps a count to agree with the
 * values it counts, a restore has nothing to rebuild, and disposables holding each other in a
 * cycle are found like any other: they stop being reachable together.
 *
 * - The roots are every live execution's frames (registers, the cells references name, kept
 *   lists), plus the objects the scheduler names: the call futures of executions running on its
 *   run stack, which keep themselves alive until they suspend, and objects waiting in a collection
 *   round (collector.ts).
 * - An object holds what snapshot.ts's `heldObjects` says; a slot's queue, a weak reference and
 *   what `disposed()` watches hold nothing.
 * - The one walk also finds how deep the deepest held value nests, which is what a commit checks
 *   against `maximumDepth` (spec §5), so a commit walks the live state once.
 * - Asking about some objects (`heldUnlessAll`) walks breadth first, from the roots in the order
 *   given, and stops once it has found them all held: what code lets go of is usually still held
 *   close by, by the frames running it, which the scheduler gives first.
 */

import { depthOf, handlesIn, type Value } from '../../definition/values.ts';
import { pushAll } from '../../structures/stack.ts';
import type { ActiveFrame } from '../interpreter/machine.ts';
import type { Heap, LiveObject } from '../scheduler/heap.ts';
import { isReference } from '../snapshot/objects.ts';
import { heldObjects, valuesIn } from '../snapshot/snapshot.ts';

/** What of a frame holds things: its registers, and its kept list. */
export type HoldingFrame = Pick<ActiveFrame, 'registers' | 'kept'>;

/** Where holding starts: frames, and objects held for the scheduler's own reasons. */
export interface Roots {
  readonly frames: Iterable<HoldingFrame>;
  readonly objects: Iterable<number>;
}

/** What a walk from the roots found. */
export interface Held {
  /** Every object held, executions aside: an execution is a root while it lives. */
  readonly objects: ReadonlySet<number>;
  /** How deep the deepest value the roots and held objects hold nests. */
  readonly depth: number;
}

/** The objects of `heap` held from `roots`, and how deep what they hold nests. */
export function heldFrom(heap: Heap, roots: Roots): Held {
  const frames = [...roots.frames];
  const objects = reached(heap, frames, roots.objects, () => false);
  const values = [
    ...frames.flatMap(valuesOfFrame),
    ...[...objects].flatMap((id) => valuesOf(heap, id)),
  ];
  return { objects, depth: deepestOf(values) };
}

/**
 * The objects of `heap` held from `roots`; undefined as soon as every object of `wanted` is found
 * held, where the walk stops.
 */
export function heldUnlessAll(
  heap: Heap,
  roots: Roots,
  wanted: ReadonlySet<number>,
): ReadonlySet<number> | undefined {
  let missing = wanted.size;
  const found = reached(heap, [...roots.frames], roots.objects, (id) => {
    missing -= wanted.has(id) ? 1 : 0;
    return missing === 0;
  });
  return missing === 0 ? undefined : found;
}

/** What a walk does at an object it reaches: go on through what it holds, pass it, or end. */
export type Step = 'through' | 'past' | 'end';

/**
 * Walks the objects of `heap` that `seeds` reach through what objects hold, breadth first in the
 * seeds' order, each object once: `visit` sees each one reached and says how the walk goes on.
 */
export function walkHolds(
  heap: Heap,
  seeds: Iterable<number>,
  visit: (object: LiveObject) => Step,
): void {
  const seen = new Set<number>();
  const queue = [...seeds];
  for (const id of queue) {
    if (!seen.has(id) && heap.has(id)) {
      seen.add(id);
      const step = visit(heap.objectOf(id));
      if (step === 'end') {
        return;
      }
      if (step === 'through') {
        pushAll(queue, holdsOf(heap.objectOf(id)));
      }
    }
  }
}

/** What `object` holds; an execution, a root while it lives, is never held through. */
export function holdsOf(object: LiveObject): readonly number[] {
  return object.kind === 'execution' ? [] : heldObjects(object);
}

/** The objects reached from `frames` and `objects`, until `stop` says to, asked of each. */
function reached(
  heap: Heap,
  frames: readonly HoldingFrame[],
  objects: Iterable<number>,
  stop: (id: number) => boolean,
): Set<number> {
  const found = new Set<number>();
  const seeds = [...objects];
  for (const frame of frames) {
    pushAll(seeds, cellsOfFrame(frame));
    pushAll(seeds, valuesOfFrame(frame).flatMap(handlesIn));
  }
  walkHolds(heap, seeds, (object) => {
    found.add(object.id);
    return stop(object.id) ? 'end' : 'through';
  });
  return found;
}

function valuesOf(heap: Heap, id: number): readonly Value[] {
  const object = heap.objectOf(id);
  return object.kind === 'execution' ? [] : valuesIn(object);
}

/** The values a frame holds: in its registers, references aside, and in its kept list. */
function valuesOfFrame(frame: HoldingFrame): readonly Value[] {
  const inRegisters = frame.registers.filter(
    (contents): contents is Value => contents !== undefined && !isReference(contents),
  );
  return [...inRegisters, ...frame.kept];
}

/** The cells a frame's references name, which a reference holds for its call. */
function cellsOfFrame(frame: HoldingFrame): readonly number[] {
  return frame.registers.flatMap((contents) =>
    contents !== undefined && isReference(contents) ? [contents.cell] : [],
  );
}

function deepestOf(values: readonly Value[]): number {
  return values.reduce<number>((deepest, contents) => Math.max(deepest, depthOf(contents)), 0);
}
