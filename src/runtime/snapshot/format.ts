/**
 * An instance's snapshot (§5): everything a committed ista instance is, written at the end of every
 * segment, so a runtime reading it back resumes where the instance committed.
 *
 * - **Frames are data** (ir-first design, decision 3): an execution is its frame record, its
 *   entry's index, the label of the `park` it stands at and its registers, so a snapshot means something only beside the
 *   Definition it names by hash.
 * - **Objects by id**: cells, futures, executions, weak references and resources, each under its
 *   id from the instance's serial, which a value names as a handle. Values are written as trees: a
 *   composite two holders share comes back as two copies, which value semantics can't tell apart.
 * - **Holders are not written**: each object's count is the count of what holds it, which reading
 *   the snapshot back counts again (restore.ts), but of a disposed object, which nothing holds.
 * - **What ended an instance** is its status: its outcome, or its panic with the time its failed
 *   segment started, so a retry sees the same clock (§3.12), or its termination.
 */

import { z } from 'zod';
import { contentHashText } from '../../definition/formats/binary-format.ts';
import { defineFormat } from '../../definition/formats/format.ts';
import {
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

const waiting = z.strictObject({
  callback: value,
  rank: z.array(integer),
  standing: value,
  cancelled: value,
});

/** What every object states: its id, and whether it was disposed, which nothing undoes (§7). */
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
    callbacks: z.array(waiting),
    lost: z.boolean(),
    onAwaited: z.array(value),
    /** The future it follows, until that settles, and the closure converting its value. */
    follows: z.strictObject({ future: objectId, converter: value }).optional(),
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
    /** What holds the futures its wait's cases are registered on, which it holds (§7). */
    awaiting: z.array(value),
    disposing: objectId.optional(),
    /** The transients' cells visible where it started (§3.4), which it keeps. */
    transients: z
      .array(z.strictObject({ function: functionId, register: registerIndex, cell: objectId }))
      .optional(),
  }),
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
  z.strictObject({
    kind: z.literal('mock'),
    ...identity,
    target: functionId,
    replacement: value,
    calls: z.array(value),
  }),
]);

export type PersistedObject = z.output<typeof object>;
export type PersistedRegister = z.output<typeof register>;

/**
 * What a retry runs again of a segment that panicked (§3.12): the call the instance was spawned to
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
  /** The instances it was spawned from, nearest first (§9). */
  lineage: z.array(z.string()),
  status,
  /** The id the instance's next object takes. */
  serial: count,
  /** The secret seed of its random source (§3.8 `random`), and how many draws it made. */
  seed: z.string().regex(/^[0-9a-f]{64}$/u),
  draws: count,
  spawned: count,
  crashEveryAwait: z.boolean(),
  /** Whether its panic terminates it at once, an isolated instance's (§9 `runtime.isolate`). */
  terminatesOnPanic: z.boolean(),
  /** The entry encoding the outcome of a spawned instance, when a codec writes it (§9). */
  encoder: functionId.optional(),
  objects: z.array(object),
  /** The executions that haven't ended, in the order they started. */
  live: z.array(objectId),
  timers: z.array(z.strictObject({ at: integer, future: objectId })),
  /** The futures settling with how another instance ends (§9), and the instance each watches. */
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
});

export type Snapshot = z.output<typeof body>;

export const snapshotFormat = defineFormat('istalang-snapshot', 1, body);
