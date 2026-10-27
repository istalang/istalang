/**
 * What each kind of heap object holds, and what it only watches (spec §6, §7): one entry per kind,
 * and per kind of future state, so a new kind fails to compile until it says both. Holding decides
 * lifetimes (runtime/lifetimes/); every id an object refers to, held or watched, must name an
 * object of its snapshot (snapshot.ts).
 *
 * - An object holds the handles in the values it holds, and some ids directly: a pending slot
 *   operation its slot, a `first` its futures, a `disposed()` watch its weak reference, and a
 *   frame's reference the cell it names.
 * - It watches what it names without holding: a slot's queue of waiting operations, what a weak
 *   reference refers to, and an execution's own call future, which its caller holds.
 * - A frame holds the same whether it is live (interpreter/machine.ts) or stored (objects.ts), so
 *   one rule reads both, over what their registers hold and their kept lists.
 */

import { handlesIn, type Value } from '../../definition/values.ts';
import { type Frame, type HeapObject, isReference, type RegisterContents } from './objects.ts';

/** A frame as holding reads it: what its registers hold, an empty one undefined, and its kept list. */
export interface HoldingFrame {
  readonly registers: readonly (RegisterContents | undefined)[];
  readonly kept: readonly Value[];
}

/** How one kind of object holds and watches. */
interface KindHoldings<Object> {
  /** Every value it holds, each counted once with whatever it contains. */
  readonly values: (object: Object) => readonly Value[];
  /** The ids it holds itself, rather than through a value. */
  readonly holds: (object: Object) => readonly number[];
  /** The ids it names without holding them. */
  readonly watches: (object: Object) => readonly number[];
}

type ObjectOf<Kind extends HeapObject['kind']> = Extract<HeapObject, { kind: Kind }>;

type FutureState = ObjectOf<'future'>['state'];

type StateOf<Kind extends FutureState['kind']> = Extract<FutureState, { kind: Kind }>;

const nothing = (): readonly never[] => [];

/** What a future holds by its state; a future watches nothing. */
const futureStates: {
  readonly [Kind in FutureState['kind']]: Omit<KindHoldings<StateOf<Kind>>, 'watches'>;
} = {
  resolved: { values: (state) => [state.value], holds: nothing },
  call: { values: nothing, holds: nothing },
  slot: { values: (state) => present(state.value), holds: (state) => [state.slot] },
  timer: { values: nothing, holds: nothing },
  host: { values: nothing, holds: nothing },
  first: { values: nothing, holds: (state) => state.futures },
  disposed: { values: nothing, holds: (state) => [state.weakRef] },
  watch: { values: nothing, holds: nothing },
};

const kinds: { readonly [Kind in HeapObject['kind']]: KindHoldings<ObjectOf<Kind>> } = {
  cell: { values: (cell) => [cell.value], holds: nothing, watches: nothing },
  slot: { values: (slot) => present(slot.value), holds: nothing, watches: (slot) => slot.waiting },
  future: {
    values: ({ state }) => stateEntry(state).values(state),
    holds: ({ state }) => stateEntry(state).holds(state),
    watches: nothing,
  },
  weakRef: { values: nothing, holds: nothing, watches: (weak) => present(weak.target) },
  guard: { values: (guard) => [guard.callback], holds: nothing, watches: nothing },
  resource: { values: nothing, holds: nothing, watches: nothing },
  mock: { values: (mock) => [mock.replacement, ...mock.calls], holds: nothing, watches: nothing },
  answer: { values: nothing, holds: (answer) => [answer.future], watches: nothing },
  execution: {
    values: ({ frames }) => frames.flatMap((frame) => frameValues(holdingFrame(frame))),
    holds: ({ frames }) => frames.flatMap((frame) => frameCells(holdingFrame(frame))),
    watches: (execution) => present(execution.resolves),
  },
};

/**
 * The ids of the objects `object` holds (spec §7): directly, or through a handle in a value it
 * holds. What nothing holds any more is disposed (runtime/lifetimes/).
 */
export function heldObjects(object: HeapObject): readonly number[] {
  const entry = entryOf(object);
  return [...entry.holds(object), ...entry.values(object).flatMap(handlesIn)];
}

/** Every value `object` holds, each counted once with whatever it contains. */
export function valuesIn(object: HeapObject): readonly Value[] {
  return entryOf(object).values(object);
}

/** The ids of the objects `object` refers to: the ones it holds, and the ones it only watches. */
export function referencedObjects(object: HeapObject): readonly number[] {
  return [...heldObjects(object), ...entryOf(object).watches(object)];
}

/** The values `frame` holds: in its registers, references aside, and in its kept list. */
export function frameValues(frame: HoldingFrame): readonly Value[] {
  const inRegisters = frame.registers.filter(
    (contents): contents is Value => contents !== undefined && !isReference(contents),
  );
  return [...inRegisters, ...frame.kept];
}

/** The cells `frame`'s references name, which a reference holds for its call. */
export function frameCells(frame: HoldingFrame): readonly number[] {
  return frame.registers.flatMap((contents) =>
    contents !== undefined && isReference(contents) ? [contents.cell] : [],
  );
}

/** A stored frame as holding reads it, which needs what its registers hold but not where. */
function holdingFrame(frame: Frame): HoldingFrame {
  return { registers: frame.registers.map(([, contents]) => contents), kept: frame.kept };
}

/** The entry of `object`'s kind, typed for the object as its union sees it. */
function entryOf(object: HeapObject): KindHoldings<HeapObject> {
  return kinds[object.kind] as KindHoldings<HeapObject>;
}

/** The entry of `state`'s kind, typed for the state as its union sees it. */
function stateEntry(state: FutureState): Omit<KindHoldings<FutureState>, 'watches'> {
  return futureStates[state.kind] as Omit<KindHoldings<FutureState>, 'watches'>;
}

function present<Item>(item: Item | undefined): readonly Item[] {
  return item === undefined ? [] : [item];
}
