/**
 * What a snapshot's heap holds: the objects handles point at, and the executions with their
 * frames as data (spec §5).
 *
 * Only what can't be derived is stored:
 * - Object ids are allocated in increasing order and never reused, so id order is creation order,
 *   which disposal follows in reverse (spec §7). No creation counter is stored.
 * - Nothing about holders is stored. Whether an object is held is decided by reachability from
 *   the executions' frames (runtime/lifetimes/), so nothing can disagree with the values that hold
 *   it.
 * - What an execution waits on is not stored either: its frame stops at an `await` or `select`
 *   (instructions/suspension.ts), whose registers name the futures.
 * - Timers are the futures whose state is a timer.
 *
 * Disposability follows from an object's kind and state, its type, and whether a weak reference
 * refers to it, never from a flag of its own (runtime/lifetimes/disposal.ts). Slots, futures, guards
 * and mocks are disposed by the runtime, and an execution is stopped when its call future is. A cell
 * or resource is disposable as its type entry's `disposal` says (definition/types.ts), so a restore
 * knows that a `Lease` handle's cell has a `dispose` to call and a `Shared<int>` cell doesn't.
 *
 * The slot, future and resource parts are what the language's concurrency and disposal need before
 * any code runs them, so they may still change as that code arrives (docs/arch/definition.md).
 */

import { z } from 'zod';
import { fieldPath } from '../../definition/instructions/places.ts';
import { functionId, label, objectId, register, typeId } from '../../definition/operands.ts';
import { integer, type Value, value } from '../../definition/values.ts';

/**
 * What a reference parameter's register holds: a cell and field positions into its value, the
 * live form of a place (definition/instructions/places.ts). It exists only in registers;
 * references are never values (spec §3.7).
 */
const reference = z.strictObject({ kind: z.literal('reference'), cell: objectId, path: fieldPath });

export type Reference = z.output<typeof reference>;

/** What a register holds: a value, or for a reference parameter, a reference. */
export type RegisterContents = Value | Reference;

/** Whether a register holds a reference rather than a value. */
export function isReference(contents: RegisterContents): contents is Reference {
  return contents !== null && typeof contents === 'object' && contents.kind === 'reference';
}

const frame = z.strictObject({
  function: functionId,
  /**
   * The top frame points at the `await` or `select` it stopped at; a caller frame points at the
   * `call` it made. Resuming writes the result to that instruction's `dst` (or a `select` case's
   * `bind`) and continues after it, or at the winning case's target (docs/arch/definition.md,
   * "Frames").
   */
  pc: label,
  /** Registers that hold something, as [register, contents]; the others are empty. */
  registers: z.array(z.tuple([register, z.union([value, reference])])),
  /** Set when the frame runs a mock's replacement in its own instance, so its result arrives. */
  arrives: z.literal(true).optional(),
});

export type Frame = z.output<typeof frame>;

const futureState = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('resolved'), value }),
  /** The result of an async call, resolved when the execution that names it returns. */
  z.strictObject({ kind: z.literal('call') }),
  /** A pending `put`, `take` or `read`, queued on the slot in `waiting` order. */
  z.strictObject({
    kind: z.literal('slot'),
    slot: objectId,
    operation: z.enum(['put', 'take', 'read']),
    value: value.optional(),
  }),
  /** `time.at(t)`: due at `at`, in milliseconds since the Unix epoch. */
  z.strictObject({ kind: z.literal('timer'), at: integer }),
  /** A future the host fills; `token` is how the host names it. */
  z.strictObject({ kind: z.literal('host'), token: z.string() }),
  /**
   * `futures.first(fs)`: resolves with the position and value of the first of `futures` to
   * resolve, the lowest position among futures that resolved together (spec §3.8).
   */
  z.strictObject({ kind: z.literal('first'), futures: z.array(objectId).min(1) }),
  /**
   * `w.disposed()` and `worker.disposing()` (spec §6, §7): resolves when the referent of the weak
   * reference `weakRef` is disposed; with no referent left, never.
   */
  z.strictObject({ kind: z.literal('disposed'), weakRef: objectId }),
  /**
   * A wait on another instance, `instance`, as its last commit says. `inst.result()` (spec §9)
   * waits until it has ended, and resolves with a `Result` of type entry `result`: `Ok` of its
   * outcome, or `Err` of its panic. A test's `t.idle()` and `t.reaches(label)` (§10) wait until it
   * is idle or waits at waypoint `label`, which only the runtime running the test can tell
   * (runtime/testing/).
   */
  z.strictObject({
    kind: z.literal('watch'),
    instance: z.string(),
    until: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('ended'), result: typeId }),
      z.strictObject({ kind: z.literal('idle') }),
      z.strictObject({ kind: z.literal('waypoint'), label: z.string() }),
    ]),
  }),
]);

export type FutureState = z.output<typeof futureState>;

/** A pending watch's condition (§9, §10). */
export type Watch = Extract<FutureState, { kind: 'watch' }>;

/** A condition only the runtime running a test can tell (§10). */
export type TestWatch = Exclude<Watch['until'], { kind: 'ended' }>;

/** A heap object schema: `kind` and `id`, plus its own fields. */
function defineObject<const Kind extends string, Shape extends z.ZodRawShape>(
  kind: Kind,
  shape: Shape,
) {
  return z.strictObject({ kind: z.literal(kind), id: objectId, ...shape });
}

export const heapObject = z.discriminatedUnion('kind', [
  /**
   * A cell: a shared struct's value (spec §3.18), a variable passed by `&`, or a `let` a closure
   * captured. `type` is the shared struct's entry, or the `_Cell<T>` a variable lives in (§3.14).
   */
  defineObject('cell', { type: typeId, value }),
  /** Full when `value` is present; `waiting` lists pending operation futures, oldest first. */
  defineObject('slot', { value: value.optional(), waiting: z.array(objectId) }),
  defineObject('future', { state: futureState }),
  /**
   * A weak reference, the one to its referent (spec §7): `target` is the referent's id while it
   * lives, or why it is gone once it was disposed or its call ended.
   */
  defineObject('weakRef', {
    target: z.union([objectId, z.enum(['disposed', 'returned'])]),
  }),
  /** A `defer` guard: disposing it calls `callback` (spec §7). */
  defineObject('guard', { callback: value }),
  /** A host value of an extern type that declares a `dispose` (docs/arch/definition.md). */
  defineObject('resource', { type: typeId, payload: z.unknown() }),
  /**
   * A held `Mock<F>`: while it exists, calls to `target` go to `replacement`, and `calls` records
   * each call's arguments as a tuple, for `m.calls()` (spec §10).
   */
  defineObject('mock', { target: functionId, replacement: value, calls: z.array(value) }),
  /**
   * A call another instance made to one of this instance's mocks (spec §10), answered here: when
   * `future` resolves, its value fills the future `instance` named `token`, or, when it is itself
   * a future, the answer waits on that one instead, and is then `followed`. An answer is a root,
   * held until it is given.
   */
  defineObject('answer', {
    future: objectId,
    instance: z.string(),
    token: z.string(),
    followed: z.boolean(),
  }),
  /**
   * An execution: a call stack, innermost frame last. An async call's execution names the future
   * its return resolves (spec §3.3); the root, the instance's own, names none.
   */
  defineObject('execution', {
    resolves: objectId.optional(),
    frames: z.array(frame).min(1),
    /** Set once the call is disposed; its next await stops it (spec §7). */
    disposing: z.boolean(),
  }),
]);

export type HeapObject = z.output<typeof heapObject>;
