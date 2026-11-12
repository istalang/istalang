/**
 * What each kind of heap object holds, and what it only watches (spec §6, §7): one entry per kind,
 * and per kind of future state, so a new kind fails to compile until it says both. Holding decides
 * lifetimes (runtime/lifetimes/); every id an object refers to, held or watched, must name an
 * object of its snapshot (snapshot.ts).
 *
 * - An object holds the handles in the values it holds, and some ids directly: a pending slot
 *   operation its slot, a `disposed()` watch its weak reference, and a frame's reference the cell
 *   it names.
 * - A pending resolver holds its callbacks, and a `Resolver.at` one the resolver it decides: what
 *   can still decide a resolver keeps it. A registration holds one end, as the resolver's chain's
 *   root says (`isHeldFromRoot`), the other only watching, so registering never makes a cycle. A
 *   wait's case's chain is held from the wait down, as the wait ends it: the wait holds its case
 *   resolvers and each resolver the `Resolver.at` ones deciding it, those awaited, and each holds
 *   the futures it is registered on. A callback's is held from its futures up, as only they can
 *   resolve it: each future holds what is registered on it. The edges to what is registered on, or
 *   decides, an object are read off the heap's indexes (`Heap.holds`).
 * - A run, a call a resolver readied, holds what it calls with, and a context constant its value.
 * - It watches what it names without holding: a slot's queue of waiting operations, what a weak
 *   reference refers to, an execution's own call future, which its caller holds, a wait's waiter,
 *   a pending case resolver's wait, which the waiter's frame holds, and the end of a registration
 *   it doesn't hold.
 * - A frame holds the same whether it is live (interpreter/frames.ts) or stored (objects.ts), so
 *   one rule reads both, over what their registers hold.
 */

import { handlesIn, type Value } from '../../definition/values/values.ts';
import { type Handlers, handlerOf } from '../../foundation/structures/kind-table.ts';
import {
  chainRoot,
  type Frame,
  type FutureState,
  type HeapObject,
  isReference,
  type RegisterContents,
  type ResolverTarget,
} from './objects.ts';

/** A frame as holding reads it: what its registers hold, an empty one undefined. */
export interface HoldingFrame {
  readonly registers: readonly (RegisterContents | undefined)[];
}

/**
 * The kinds of the roots, objects kept for their own sake rather than held by another: an
 * execution, a run, an answer, the outcome an instance awaits, and a context constant's value.
 */
export const rootKinds = ['execution', 'run', 'answer', 'outcome', 'contextConstant'] as const;

type RootKind = (typeof rootKinds)[number];

const roots: ReadonlySet<HeapObject['kind']> = new Set(rootKinds);

/** Whether `object` is a root (`rootKinds`). */
export function isRoot<Object extends { readonly kind: HeapObject['kind'] }>(
  object: Object,
): object is Extract<Object, { readonly kind: RootKind }> {
  return roots.has(object.kind);
}

/**
 * What a holder holds: a register, a heap object, or what holds through an index or a running
 * call's stack. Each write of a holder reports what it held and what it holds now
 * (runtime/lifetimes/holder-writes.ts).
 */
export interface Held {
  /** Every value it holds, each counted once with whatever it contains. */
  readonly values: readonly Value[];
  /** The ids it holds itself, rather than through a value. */
  readonly holds: readonly number[];
}

/** What holds nothing: an empty register, an object not made yet or gone. */
export const nothingHeld: Held = { values: [], holds: [] };

/** What one object holds, and what it watches. */
interface Holding extends Held {
  /** The ids it names without holding them. */
  readonly watches: readonly number[];
}

const empty: Holding = { ...nothingHeld, watches: [] };

/** What a future holds by its state; a future watches nothing. */
const futureStates: Handlers<undefined, FutureState, [], Held> = {
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
  resolver: (_context, { state }) => (state.kind === 'pending' ? pendingResolver(state) : empty),
  run: (_context, run) => ({ ...empty, values: [...run.captures, ...run.arguments] }),
  contextConstant: (_context, constant) => ({ ...empty, values: [constant.value] }),
  execution: (_context, { frames, resolves }) => ({
    values: frames.flatMap((frame) => frameValues(holdingFrame(frame))),
    holds: frames.flatMap((frame) => frameCells(holdingFrame(frame))),
    watches: present(resolves),
  }),
};

type PendingResolverState = Extract<
  Extract<HeapObject, { kind: 'resolver' }>['state'],
  { kind: 'pending' }
>;

/** What a pending resolver holds: its callbacks, what it decides, its futures as its root says. */
function pendingResolver({ target, on, onCancel }: PendingResolverState): Holding {
  const values = [...(target.kind === 'callback' ? [target.callback] : []), ...onCancel];
  const decides = target.kind === 'at' ? [target.done] : [];
  const waits = target.kind === 'case' ? [target.wait] : [];
  return isHeldFromRoot(target)
    ? { values, holds: [...on, ...decides], watches: waits }
    : { values, holds: decides, watches: on };
}

/**
 * Whether the chain of a resolver deciding `target` is held from its root down, a wait's case's,
 * rather than from the futures it is registered on up, a callback's (spec §7).
 */
export function isHeldFromRoot(target: ResolverTarget): boolean {
  return chainRoot(target) === 'case';
}

/**
 * The ids of the objects `object` holds (spec §7): directly, or through a handle in a value it
 * holds. What nothing holds any more is disposed (runtime/lifetimes/).
 */
export function heldObjects(object: HeapObject): readonly number[] {
  return idsHeld(holdingOf(object));
}

/** What `object` holds by its fields and values, an execution by its frames (`heldObjects`). */
export function heldBy(object: HeapObject): Held {
  const { values, holds } = holdingOf(object);
  return { values, holds };
}

/** What a register holding `contents` holds: its value, or a reference's cell (`frameCells`). */
export function heldIn(contents: RegisterContents | undefined): Held {
  if (contents === undefined) {
    return nothingHeld;
  }
  return isReference(contents)
    ? { values: [], holds: [contents.cell] }
    : { values: [contents], holds: [] };
}

/** The ids `held` holds: itself, or through a handle in one of its values. */
export function idsHeld(held: Held): readonly number[] {
  const inValues = held.values.flatMap(handlesIn);
  return held.holds.length === 0 ? inValues : [...held.holds, ...inValues];
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
