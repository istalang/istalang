/**
 * What a snapshot's heap holds: the objects handles point at, and the executions with their
 * frames as data (spec §5).
 *
 * Only what can't be derived is stored:
 * - An object id is a serial: ids are given in increasing order and never twice, so id order is
 *   creation order, which disposal follows in reverse (spec §7). The snapshot keeps how many were
 *   given (`objectsMade`, snapshot.ts), so a restored instance numbers its next object as the one
 *   that committed would, after however many the commit let go of.
 * - Nothing about holders is stored. A restored instance counts each object's holders afresh
 *   from the values that hold it (runtime/lifetimes/counts.ts), so nothing can disagree with them.
 * - An execution waits on a wait its frame holds in a register (proposal 8, Rule 5), decided by the
 *   first of its cases' resolvers to resolve. A future's `onAwait` registers a resolver on it, and
 *   the registration holds one end, as the resolver's chain's root says (snapshot/holdings.ts,
 *   runtime/scheduler/instance/heap.ts `Heap.holds`). A `Resolver.at` resolver records that root,
 *   fixed when it is made, rather than finding it through the resolvers it decides: those end
 *   before it does, while what it held must still be known.
 *   Resolving a `Resolver.of` resolver, or cancelling one with `onCancel` callbacks, readies a
 *   `run` of each callback, which the ready queue holds beside waiters.
 * - Timers are the futures whose state is a timer.
 *
 * Disposability follows from an object's kind and state, its type, and whether a weak reference
 * refers to it, never from a flag of its own (runtime/lifetimes/disposal.ts). Slots, futures
 * and mocks are disposed by the runtime, and an execution is stopped when its call future
 * is. A cell or resource is disposable as its type entry's `disposal` says
 * (definition/tables/types.ts), so a restore knows that a `Lease` handle's cell has a `dispose` to
 * call and a `Shared<Int>` cell doesn't.
 *
 * The slot, future and resource parts are what the language's concurrency and disposal need before
 * any code runs them, so they may still change as that code arrives (docs/arch/definition.md).
 */

import { z } from 'zod';
import { fieldPath } from '../../definition/instructions/places.ts';
import { count, functionId, label, objectId, register, typeId } from '../../definition/operands.ts';
import { integer, type Value, value } from '../../definition/values/values.ts';

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

/**
 * A transient's cell an execution keeps from where it started (spec §3.4): the cell object `cell`
 * that `register` of a frame running `function` held, which the execution's calls of that function
 * share.
 */
const transientCell = z.strictObject({ function: functionId, register, cell: objectId });

export type TransientCell = z.output<typeof transientCell>;

const futureState = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('resolved'), value }),
  /** The result of an async call, resolved when the execution that names it returns. */
  z.strictObject({ kind: z.literal('call') }),
  /**
   * A pending `put`, `take` or `read`, queued on the slot in `waiting` order; `givenUp` once a
   * losing case awaited it (runtime/scheduler/instance/slots.ts).
   */
  z.strictObject({
    kind: z.literal('slot'),
    slot: objectId,
    operation: z.enum(['put', 'take', 'read']),
    value: value.optional(),
    givenUp: z.boolean(),
  }),
  /** `time.at(t)`: due at `at`, in milliseconds since the Unix epoch. */
  z.strictObject({ kind: z.literal('timer'), at: integer }),
  /** A future the host fills; `token` is how the host names it. */
  z.strictObject({ kind: z.literal('host'), token: z.string() }),
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

/**
 * A wait (proposal 8, Rule 5): pending, or decided, its waiter to resume at case `position` with
 * `value`. It decides once.
 */
const waitState = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('pending') }),
  z.strictObject({ kind: z.literal('decided'), position: count, value }),
]);

/** What a chain of resolvers comes down to deciding: a wait's case, or a callback. */
const chainRoots = z.enum(['case', 'callback']);

export type ChainRoot = z.output<typeof chainRoots>;

/**
 * What a resolver decides once resolved: case `position` of `wait`; a `Resolver.of` call of
 * `callback` with its value; or, `Resolver.at`, the resolver `done` with `(position, value)`, in a
 * chain coming down to `root`.
 */
const resolverTarget = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('case'), wait: objectId, position: count }),
  z.strictObject({ kind: z.literal('callback'), callback: value }),
  z.strictObject({ kind: z.literal('at'), done: objectId, position: integer, root: chainRoots }),
]);

export type ResolverTarget = z.output<typeof resolverTarget>;

/** What the chain of a resolver deciding `target` comes down to deciding. */
export function chainRoot(target: ResolverTarget): ChainRoot {
  return target.kind === 'at' ? target.root : target.kind;
}

/**
 * A resolver (proposal 8, Rule 5): pending for its `target`, registered `on` the futures whose
 * `onAwait` was given it, in that order, with the `onCancel` callbacks to call if it is cancelled;
 * resolved; or cancelled, what it decides decided otherwise or ended, or its future disposed, after
 * which resolving it does nothing.
 */
const resolverState = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('pending'),
    target: resolverTarget,
    on: z.array(objectId),
    onCancel: z.array(value),
  }),
  z.strictObject({ kind: z.literal('resolved') }),
  z.strictObject({ kind: z.literal('cancelled') }),
]);

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
    target: z.union([objectId, z.enum(['disposed', 'callEnded'])]),
  }),
  /** A host value of an extern type that declares a `dispose` (docs/arch/definition.md). */
  defineObject('resource', { type: typeId, payload: z.unknown() }),
  /**
   * A held `Mock<F>`: while it exists, calls to `target` go to `replacement`, and `calls` records
   * each call's arguments as a tuple, for `m.calls()` (spec §10).
   */
  defineObject('mock', { target: functionId, replacement: value, calls: z.array(value) }),
  /**
   * A call made to this instance from outside, answered here: another instance's call to one of its
   * mocks (spec §10), or with no `instance`, a host's call into it as a context (§9). When `future`
   * resolves, its value fills the future the caller named `token`, or, when it is itself a future,
   * the answer waits on that one instead, and is then `followed`. An answer is a root, held until
   * it is given.
   */
  defineObject('answer', {
    future: objectId,
    instance: z.string().optional(),
    token: z.string(),
    followed: z.boolean(),
  }),
  /**
   * The future an instance ends with (spec §9): what its root call gave, a simple entry's return or
   * an extern's answer, once it resolves, a future it resolves with followed in turn. Its root has
   * returned, so nothing else waits on it: it is a root, held until the instance ends.
   */
  defineObject('outcome', { future: objectId }),
  /**
   * A wait of `waiter`, the execution whose frame holds it, which an `await` or a `select` stands
   * at (proposal 8, Rule 5). It goes once its waiter moves past it, or stops.
   */
  defineObject('wait', { waiter: objectId, state: waitState }),
  /** A language `Resolver`, doing what its state says when resolved. */
  defineObject('resolver', { state: resolverState }),
  /**
   * A call readied to run as a driver of its own (proposal 8, Rule 5): a `Resolver.of` callback
   * with the value it was resolved with, or an `onCancel` callback. It is a root, held until a
   * segment reaches it among the ready and makes the call.
   */
  defineObject('run', {
    function: functionId,
    captures: z.array(value),
    arguments: z.array(value),
  }),
  /**
   * A context constant's value (spec §3.4), by the constant's qualified name: made the first time
   * code in the instance reads it, and a root from then on, kept in its memory.
   */
  defineObject('contextConstant', { key: z.string(), value }),
  /**
   * An execution: a call stack, innermost frame last. An async call's execution names the future
   * its return resolves (spec §3.3); the root, the instance's own, names none. It keeps the
   * transients' cells visible where it started (spec §3.4), none for most.
   */
  defineObject('execution', {
    resolves: objectId.optional(),
    frames: z.array(frame).min(1),
    transients: z.array(transientCell).min(1).optional(),
  }),
]);

export type HeapObject = z.output<typeof heapObject>;
