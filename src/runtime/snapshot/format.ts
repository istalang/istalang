/**
 * An instance's snapshot (§14): everything a committed ista instance is, written at the end of every
 * segment, so a runtime reading it back resumes where the instance committed.
 *
 * - **Frames are data** (ir-first design, decision 3): an execution is its frame record, its
 *   entry's index, the label of the `park` it stands at and its registers, so a snapshot means something only beside the
 *   Definition it names by hash.
 * - **Objects by id**: cells, futures, executions, calls that ended, weak references and resources,
 *   each under its id from the instance's serial, which a value names as a handle. A call that
 *   ended has no frame left, but a handle to it may outlive it (a wait's, a case's). Values are written as trees: a
 *   composite two holders share comes back as two copies, which value semantics can't tell apart.
 * - **Holders are not written**: each object's count is the count of what holds it, which reading
 *   the snapshot back counts again (restore.ts), but of a disposed object, which nothing holds.
 * - **What ended an instance** is its status: its outcome, or its panic with the time its failed
 *   segment started, so a retry sees the same clock (§12), or its termination.
 */

import { z } from 'zod';
import { contentHashText } from '../../definition/formats/binary-format.ts';
import { defineFormat } from '../../definition/formats/format.ts';
import {
  bindingId,
  count,
  functionId,
  label,
  objectId,
  register as registerIndex,
  typeId,
} from '../../definition/operands.ts';
import { externPayload, integer, value } from '../../definition/values/values.ts';

const step = z.tuple([z.enum(['elements', 'fields']), count]);

/** What a register holds: a value, a place a `&` parameter refers to, or nothing. */
const register = z.union([
  z.strictObject({ value }),
  z.strictObject({ reference: z.strictObject({ cell: objectId, path: z.array(step) }) }),
  z.null(),
]);

/** What waits on a pending future, as the prelude keeps it (run/objects/future.ts `Waiting`). */
const waiting = z.strictObject({ waiters: value, arrived: value, disposed: value });

/** What every object states: its id, and whether it was disposed, which nothing undoes (§16). */
const identity = { id: objectId, disposed: z.literal(true).optional() };

const object = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('cell'),
    ...identity,
    value,
    counted: z.boolean(),
    dispose: functionId.optional(),
  }),
  z.strictObject({
    kind: z.literal('future'),
    ...identity,
    settled: z.boolean(),
    value,
    waiting: waiting.optional(),
  }),
  z.strictObject({
    kind: z.literal('execution'),
    ...identity,
    future: objectId,
    function: functionId,
    parkedAt: label,
    registers: z.array(register),
    closure: value.optional(),
    parked: z.boolean(),
    given: z.array(register),
    /** What holds the futures its wait's cases are registered on, which it holds (§16). */
    awaiting: z.array(value),
    disposing: objectId.optional(),
    /** The transients' cells visible where it started (§7.1), which it keeps. */
    transients: z
      .array(z.strictObject({ function: functionId, register: registerIndex, cell: objectId }))
      .optional(),
  }),
  /**
   * A call that ended, kept as what still names its handle keeps it (a wait's, a case's): its
   * future, and no frame, which ended with it.
   */
  z.strictObject({ kind: z.literal('endedCall'), ...identity, future: objectId }),
  z.strictObject({
    kind: z.literal('weakReference'),
    ...identity,
    target: objectId.optional(),
    whenDisposed: objectId.optional(),
  }),
  z.strictObject({
    kind: z.literal('resource'),
    ...identity,
    type: typeId,
    payload: externPayload,
  }),
]);

export type PersistedObject = z.output<typeof object>;
export type PersistedRegister = z.output<typeof register>;

/**
 * What a retry runs again of a segment that panicked (§12): the call the instance was spawned to
 * run, before its first commit, or the call into it that started the segment.
 */
const replay = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('start'), call: value }),
  z.strictObject({ kind: z.literal('invocation'), call: value, passed: z.array(value) }),
]);

export type Replay = z.output<typeof replay>;

const status = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('active') }),
  z.strictObject({
    kind: z.literal('panicked'),
    message: z.string(),
    trace: z.string(),
    segmentStartedAt: integer,
    replay: replay.optional(),
  }),
  z.strictObject({ kind: z.literal('finished'), outcome: value, encoded: value.optional() }),
  z.strictObject({ kind: z.literal('terminated'), message: z.string(), trace: z.string() }),
]);

export type PersistedStatus = z.output<typeof status>;

const body = z.strictObject({
  definition: contentHashText,
  instance: z.string(),
  /** The instances it was spawned from, nearest first (§17.1). */
  lineage: z.array(z.string()),
  status,
  /** The id the instance's next object takes. */
  serial: count,
  /** The secret seed of its random source (§19.2 `random`), and how many draws it made. */
  seed: z.string().regex(/^[0-9a-f]{64}$/u),
  draws: count,
  spawned: count,
  crashEveryAwait: z.boolean(),
  /** Whether its panic terminates it at once, an isolated instance's (§17.1 `runtime.isolate`). */
  terminatesOnPanic: z.boolean(),
  /** The entry encoding the outcome of a spawned instance, when a codec writes it (§17.4). */
  encoder: functionId.optional(),
  objects: z.array(object),
  /** The executions that haven't ended, in the order they started. */
  live: z.array(objectId),
  timers: z.array(z.strictObject({ at: integer, future: objectId })),
  /** The futures settling with how another instance ends (§17.1), and the instance each watches. */
  watches: z.array(z.strictObject({ future: objectId, instance: z.string() })),
  /** What is ready to run, in order: parked calls readied, with their decisions, and callbacks. */
  ready: z.array(
    z.union([
      z.strictObject({ execution: objectId, decision: value }),
      z.strictObject({ call: value, arguments: z.array(value) }),
    ]),
  ),
  /** The calls into it still running, by their futures: its spawned call, `root`, among them. */
  invocations: z.array(z.strictObject({ future: objectId, root: z.boolean() })),
  contextConstants: z.array(z.tuple([z.string(), value])),
  /** The functions bound to entries' slots in a test (§18, run/slots.ts), oldest first. */
  bindings: z.array(z.strictObject({ id: bindingId, target: functionId, bound: value })),
});

export type Snapshot = z.output<typeof body>;

export const snapshotFormat = defineFormat('istalang-snapshot', 2, body);
