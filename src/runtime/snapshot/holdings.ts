/**
 * What each kind of heap object holds, and what it only watches (spec §6, §7): one entry per kind,
 * and per kind of future state, so a new kind fails to compile until it says both. Holding decides
 * lifetimes (runtime/lifetimes/); every id an object refers to, held or watched, must name an
 * object of its snapshot (snapshot.ts).
 *
 * - An object holds the handles in the values it holds, and some ids directly: a pending slot
 *   operation its slot, a `disposed()` watch its weak reference, and a frame's reference the cell
 *   it names.
 * - A pending resolver holds the futures it is registered on, its callbacks, and the resolver a
 *   `Resolver.at` one decides. A registration holds the resolver too, and a wait and a resolver
 *   hold what is registered to decide them, edges read off the heap's indexes (`Heap.holds`).
 * - A run, a call a resolver readied, holds what it calls with as a frame does (`runFrame`).
 * - It watches what it names without holding: a slot's queue of waiting operations, what a weak
 *   reference refers to, an execution's own call future, which its caller holds, a wait's waiter,
 *   and a pending case resolver's wait, which the waiter's frame holds.
 * - A frame holds the same whether it is live (interpreter/frames.ts) or stored (objects.ts), so
 *   one rule reads both, over what their registers hold.
 */

import { handlesIn, type Value } from '../../definition/values/values.ts';
import { type Handlers, handlerOf } from '../../foundation/structures/kind-table.ts';
import {
  type Frame,
  type FutureState,
  type HeapObject,
  isReference,
  type RegisterContents,
} from './objects.ts';

/** A frame as holding reads it: what its registers hold, an empty one undefined. */
export interface HoldingFrame {
  readonly registers: readonly (RegisterContents | undefined)[];
}

/**
 * Whether `object` is a root, kept for its own sake rather than held by another: an execution, a
 * run, an answer, or the outcome an instance awaits.
 */
export function isRoot<Object extends { readonly kind: HeapObject['kind'] }>(
  object: Object,
): object is Extract<Object, { readonly kind: 'execution' | 'run' | 'answer' | 'outcome' }> {
  return (
    object.kind === 'execution' ||
    object.kind === 'run' ||
    object.kind === 'answer' ||
    object.kind === 'outcome'
  );
}

/** What one object holds and watches. */
interface Holding {
  /** Every value it holds, each counted once with whatever it contains. */
  readonly values: readonly Value[];
  /** The ids it holds itself, rather than through a value. */
  readonly holds: readonly number[];
  /** The ids it names without holding them. */
  readonly watches: readonly number[];
}

const empty: Holding = { values: [], holds: [], watches: [] };

/** What a future holds by its state; a future watches nothing. */
const futureStates: Handlers<undefined, FutureState, [], Omit<Holding, 'watches'>> = {
  resolved: (_context, state) => ({ values: [state.value], holds: [] }),
  call: () => empty,
  slot: (_context, state) => ({ values: present(state.value), holds: [state.slot] }),
  timer: () => empty,
  host: () => empty,
  disposed: (_context, state) => ({ values: [], holds: [state.weakRef] }),
  watch: () => empty,
};

const kinds: Handlers<undefined, HeapObject, [], Holding> = {
  cell: (_context, cell) => ({ ...empty, values: [cell.value] }),
  slot: (_context, slot) => ({ values: present(slot.value), holds: [], watches: slot.waiting }),
  future: (_context, { state }) => ({
    ...handlerOf(futureStates, state)(undefined, state),
    watches: [],
  }),
  weakRef: (_context, weak) => ({
    ...empty,
    watches: typeof weak.target === 'number' ? [weak.target] : [],
  }),
  resource: () => empty,
  mock: (_context, mock) => ({ ...empty, values: [mock.replacement, ...mock.calls] }),
  answer: (_context, answer) => ({ ...empty, holds: [answer.future] }),
  outcome: (_context, outcome) => ({ ...empty, holds: [outcome.future] }),
  wait: (_context, { waiter, state }) => ({
    values: state.kind === 'decided' ? [state.value] : [],
    holds: [],
    watches: [waiter],
  }),
  resolver: (_context, { state }) =>
    state.kind === 'pending'
      ? {
          values: [
            ...(state.target.kind === 'callback' ? [state.target.callback] : []),
            ...state.onCancel,
          ],
          holds: [...state.on, ...(state.target.kind === 'at' ? [state.target.done] : [])],
          watches: state.target.kind === 'case' ? [state.target.wait] : [],
        }
      : empty,
  run: (_context, run) => ({ ...empty, values: [...run.captures, ...run.arguments] }),
  execution: (_context, { frames, resolves }) => ({
    values: frames.flatMap((frame) => frameValues(holdingFrame(frame))),
    holds: frames.flatMap((frame) => frameCells(holdingFrame(frame))),
    watches: present(resolves),
  }),
};

/**
 * The ids of the objects `object` holds (spec §7): directly, or through a handle in a value it
 * holds. What nothing holds any more is disposed (runtime/lifetimes/).
 */
export function heldObjects(object: HeapObject): readonly number[] {
  const holding = holdingOf(object);
  return [...holding.holds, ...holding.values.flatMap(handlesIn)];
}

/** Every value `object` holds, each counted once with whatever it contains. */
export function valuesIn(object: HeapObject): readonly Value[] {
  return holdingOf(object).values;
}

/** The ids of the objects `object` refers to: the ones it holds, and the ones it only watches. */
export function referencedObjects(object: HeapObject): readonly number[] {
  const holding = holdingOf(object);
  return [...holding.holds, ...holding.values.flatMap(handlesIn), ...holding.watches];
}

/** A run as holding reads it: a frame not yet made, holding the captures and arguments it gets. */
export function runFrame(run: Extract<HeapObject, { kind: 'run' }>): HoldingFrame {
  return { registers: [...run.captures, ...run.arguments] };
}

/** The values `frame` holds in its registers, references aside. */
export function frameValues(frame: HoldingFrame): readonly Value[] {
  return frame.registers.filter(
    (contents): contents is Value => contents !== undefined && !isReference(contents),
  );
}

/** The cells `frame`'s references name, which a reference holds for its call. */
export function frameCells(frame: HoldingFrame): readonly number[] {
  return frame.registers.flatMap((contents) =>
    contents !== undefined && isReference(contents) ? [contents.cell] : [],
  );
}

/** A stored frame as holding reads it, which needs what its registers hold but not where. */
function holdingFrame(frame: Frame): HoldingFrame {
  return { registers: frame.registers.map(([, contents]) => contents) };
}

function holdingOf(object: HeapObject): Holding {
  return handlerOf(kinds, object)(undefined, object);
}

function present<Item>(item: Item | undefined): readonly Item[] {
  return item === undefined ? [] : [item];
}
