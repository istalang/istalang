/**
 * An instance snapshot: everything a committed instance is, persisted at every await (spec §5).
 *
 * It names its Definition by content hash; frames hold function indexes and pcs into that
 * Definition, so a snapshot is meaningless without it. Besides the heap it keeps:
 * - the order in which executions and runs became ready
 * - how many instances it has spawned, which names the next one (`<instance>/<n>`, §9)
 * - its random source, a seed and how many draws were made from it, so a segment that runs again
 *   draws the same values (§3.8 `random`, random.ts, random.ts)
 * - its options, which a runtime that wakes it after a restart honours too: whether every segment
 *   runs twice before it commits (`crashEveryAwait`, §10), and whether a panic terminates it at
 *   once (`terminatesOnPanic`, as `runtime.isolate` starts it, §9)
 * - for a panicked instance, when the failed segment started. `now()` returns its segment's
 *   start time, so an operator's retry sees the same time (docs/arch/definition.md, "Time").
 * - the entry encoding its outcome as JSON for its host (§9), when the outcome's type has a codec
 *   writing it; a finished instance keeps that JSON beside the outcome, which `result()` copies
 *
 * Extern constant reads, which spec §3.6 pins for the instance's life, join the snapshot with the
 * host externs that need them.
 *
 * A spawned instance is written before its parent's commit, as `unstarted`: the call it will run,
 * with sendable arguments, and nothing else yet. Waking it starts that call, so the host runs a
 * spawned instance as it runs any other.
 *
 * Validation checks that ids ascend and that every object id refers to an object of this
 * snapshot. Checks that need the Definition, such as pc ranges, are check.ts's, run when the
 * runtime reads a snapshot back.
 */

import { z } from 'zod';
import { contentHashText } from '../../definition/formats/codec.ts';
import { defineFormat } from '../../definition/formats/format.ts';
import { count, functionId, objectId } from '../../definition/operands.ts';
import { integer, value } from '../../definition/values/values.ts';
import { referencedObjects } from './holdings.ts';
import { heapObject } from './objects.ts';
import { seedText } from './random.ts';

/** The call a new instance runs: an entry, a closure's captures, and its arguments (§9). */
const instanceCall = z.strictObject({
  function: functionId,
  captures: z.array(value),
  arguments: z.array(value),
});

export type InstanceCall = z.output<typeof instanceCall>;

/** A value the host fills a future it named `token` with (§9). */
const arrival = z.strictObject({ token: z.string(), value });

/**
 * What a retry of a panicked instance runs again (§3.12): the call it was starting, when it
 * panicked before its first commit; or what its host filled, when it panicked in the segment the
 * fill ran. A segment answering a call to one of its mocks has nothing to replay: mocks live only
 * in a test's world, which never retries (§10).
 */
const replay = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('call'), call: instanceCall }),
  z.strictObject({ kind: z.literal('arrival'), arrival }),
]);

export type Replay = z.output<typeof replay>;

const status = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unstarted'), call: instanceCall }),
  z.strictObject({ kind: z.literal('active') }),
  z.strictObject({
    kind: z.literal('panicked'),
    message: z.string(),
    trace: z.string(),
    segmentStartedAt: integer,
    replay: replay.optional(),
  }),
  /** Its function's outcome, and that outcome as the `Json` its encoder gave, when it has one. */
  z.strictObject({ kind: z.literal('finished'), outcome: value, encoded: value.optional() }),
  /**
   * Ended after a panic, by its operator or at once for an instance `runtime.isolate` started
   * (§3.12, §9), keeping that panic.
   */
  z.strictObject({ kind: z.literal('terminated'), message: z.string(), trace: z.string() }),
]);

const snapshotContents = z.strictObject({
  /** The content hash of the Definition this instance runs. */
  definition: contentHashText,
  instance: z.string(),
  status,
  /** Every segment runs twice, the first run discarded, before it commits (§10). */
  crashEveryAwait: z.boolean(),
  /** A panic terminates the instance at once, as `runtime.isolate` asks (§9). */
  terminatesOnPanic: z.boolean(),
  /** The entry encoding its outcome as JSON for its host (§9); none when no codec writes it. */
  encoder: functionId.optional(),
  /** How many instances this one has spawned (§9). */
  spawned: count,
  /** Its random source: the seed, and how many draws its committed segments made (§3.8). */
  random: z.strictObject({ seed: seedText, draws: count }),
  /** What each extern constant read so far gave, by key: read once, kept for life (§3.6). */
  pinned: z.array(z.strictObject({ key: z.string(), value })),
  /** In ascending id order. */
  objects: z.array(heapObject),
  /**
   * What is ready to run, in the order it became ready: executions to resume past their waits, and
   * runs to start (objects.ts).
   */
  ready: z.array(objectId),
});

type Contents = z.output<typeof snapshotContents>;

const snapshot = snapshotContents.superRefine(checkObjectReferences);

export type Snapshot = z.output<typeof snapshot>;

/** A snapshot of an instance that has panicked (§3.12). */
export type PanickedSnapshot = Snapshot & {
  readonly status: Extract<Snapshot['status'], { kind: 'panicked' }>;
};

export const snapshotFormat = defineFormat('istalang-snapshot', 1, snapshot);

function checkObjectReferences(contents: Contents, context: z.RefinementCtx): void {
  const kinds = new Map(contents.objects.map((object) => [object.id, object.kind]));
  contents.objects.forEach((object, index) => {
    const previous = contents.objects[index - 1];
    if (previous !== undefined && previous.id >= object.id) {
      context.addIssue({
        code: 'custom',
        path: ['objects', index],
        message: 'Object ids must ascend.',
      });
    }
    for (const id of referencedObjects(object).filter((target) => !kinds.has(target))) {
      context.addIssue({
        code: 'custom',
        path: ['objects', index],
        message: `No object ${id}.`,
      });
    }
  });
  contents.ready.forEach((id, index) => {
    const kind = kinds.get(id);
    if (kind !== 'execution' && kind !== 'run') {
      context.addIssue({
        code: 'custom',
        path: ['ready', index],
        message: `${id} is neither an execution nor a run.`,
      });
    }
  });
}
