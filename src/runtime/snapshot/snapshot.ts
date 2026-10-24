/**
 * An instance snapshot: everything a committed instance is, persisted at every await (spec §5).
 *
 * It names its Definition by content hash; frames hold function indexes and pcs into that
 * Definition, so a snapshot is meaningless without it. Besides the heap it keeps:
 * - the order in which executions became ready
 * - whether every segment runs twice before it commits (`crashEveryAwait`, §10), an option of the
 *   instance, so a runtime that wakes it after a restart honours it too
 * - for a panicked instance, when the failed segment started. `now()` returns its segment's
 *   start time, so an operator's retry sees the same time (docs/arch/definition.md, "Time").
 *
 * Extern constant reads, which spec §3.6 pins for the instance's life, join the snapshot with the
 * host externs that need them.
 *
 * Validation checks that ids ascend and that every object id refers to an object of this
 * snapshot. Checks that need the Definition, such as pc ranges, are check.ts's, run when the
 * runtime reads a snapshot back.
 */

import { z } from 'zod';
import { contentHashText } from '../../definition/codec.ts';
import { defineFormat } from '../../definition/format.ts';
import { objectId } from '../../definition/operands.ts';
import { handlesIn, integer, type Value, value } from '../../definition/values.ts';
import { type Frame, type HeapObject, heapObject, isReference } from './objects.ts';

const status = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('active') }),
  z.strictObject({
    kind: z.literal('panicked'),
    message: z.string(),
    trace: z.string(),
    segmentStartedAt: integer,
  }),
  z.strictObject({ kind: z.literal('finished'), outcome: value }),
]);

const snapshotContents = z.strictObject({
  /** The content hash of the Definition this instance runs. */
  definition: contentHashText,
  instance: z.string(),
  status,
  /** Every segment runs twice, the first run discarded, before it commits (§10). */
  crashEveryAwait: z.boolean(),
  /** In ascending id order. */
  objects: z.array(heapObject),
  /** Executions ready to run, in the order they became ready. */
  ready: z.array(objectId),
});

type Contents = z.output<typeof snapshotContents>;

export const snapshot = snapshotContents.superRefine(checkObjectReferences);

export type Snapshot = z.output<typeof snapshot>;

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
    if (kinds.get(id) !== 'execution') {
      context.addIssue({
        code: 'custom',
        path: ['ready', index],
        message: `${id} is not an execution.`,
      });
    }
  });
}

/** The ids of the objects `object` refers to: directly, or through a handle in a value it holds. */
export function referencedObjects(object: HeapObject): readonly number[] {
  return [...directReferences(object), ...valuesIn(object).flatMap(handlesIn)];
}

/** Every value `object` holds, each counted once with whatever it contains. */
export function valuesIn(object: HeapObject): readonly Value[] {
  switch (object.kind) {
    case 'cell':
      return [object.value];
    case 'slot':
      return object.value === undefined ? [] : [object.value];
    case 'future':
      return futureValues(object.state);
    case 'guard':
      return [object.callback];
    case 'mock':
      return [object.replacement, ...object.calls];
    case 'execution':
      return object.frames.flatMap(frameValues);
    case 'weakRef':
    case 'resource':
      return [];
    default: {
      const unhandled: never = object;
      return unhandled;
    }
  }
}

/** The ids `object` names itself, rather than through a value. */
function directReferences(object: HeapObject): readonly number[] {
  switch (object.kind) {
    case 'slot':
      return object.waiting;
    case 'future':
      return futureTargets(object.state);
    case 'weakRef':
      return object.target === undefined ? [] : [object.target];
    case 'execution':
      return object.frames.flatMap(({ registers }) =>
        registers.flatMap(([, contents]) => (isReference(contents) ? [contents.cell] : [])),
      );
    case 'cell':
    case 'guard':
    case 'resource':
    case 'mock':
      return [];
    default: {
      const unhandled: never = object;
      return unhandled;
    }
  }
}

type FutureState = Extract<HeapObject, { kind: 'future' }>['state'];

function futureValues(state: FutureState): readonly Value[] {
  switch (state.kind) {
    case 'resolved':
      return [state.value];
    case 'slot':
      return state.value === undefined ? [] : [state.value];
    case 'call':
    case 'timer':
    case 'host':
    case 'disposed':
    case 'disposing':
      return [];
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}

function futureTargets(state: FutureState): readonly number[] {
  switch (state.kind) {
    case 'call':
    case 'disposing':
      return [state.execution];
    case 'slot':
      return [state.slot];
    case 'disposed':
      return [state.target];
    case 'resolved':
    case 'timer':
    case 'host':
      return [];
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}

/** A frame's values: what its registers hold, the keys in its references' paths, and its kept list. */
function frameValues(frame: Frame): readonly Value[] {
  const inRegisters = frame.registers.flatMap(([, contents]) =>
    isReference(contents)
      ? contents.path.flatMap((step) => (step.kind === 'element' ? [step.key] : []))
      : [contents],
  );
  return [...inRegisters, ...frame.kept];
}
