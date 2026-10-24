/**
 * An instance snapshot: everything a committed instance is, persisted at every await (spec §5).
 *
 * It names its Definition by content hash; frames hold function indexes and pcs into that
 * Definition, so a snapshot is meaningless without it. Besides the heap it keeps the order in which
 * executions became ready, plus the two things determinism needs:
 * - extern constant reads, pinned at first read so every later segment sees the same value
 *   (spec §3.6)
 * - for a panicked instance, when the failed segment started. `now()` returns its segment's
 *   start time, so an operator's retry sees the same time (docs/arch/definition.md, "Time").
 *
 * Validation checks that ids ascend and that every object id refers to an object of this
 * snapshot. Checks that need the Definition, such as pc ranges, belong to the runtime's load.
 */

import { z } from 'zod';
import { contentHashText } from '../../definition/codec.ts';
import { defineFormat } from '../../definition/format.ts';
import { functionId, objectId } from '../../definition/operands.ts';
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
  /** Extern constants read so far, by function-table entry, pinned for the instance's life. */
  externReads: z.array(z.strictObject({ function: functionId, value })),
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

function referencedObjects(object: HeapObject): readonly number[] {
  switch (object.kind) {
    case 'cell':
      return handlesIn(object.value);
    case 'slot':
      return [...optionalHandles(object.value), ...object.waiting];
    case 'future':
      return futureReferences(object.state);
    case 'weakRef':
      return object.target === undefined ? [] : [object.target];
    case 'guard':
      return handlesIn(object.callback);
    case 'resource':
      return [];
    case 'mock':
      return [object.replacement, ...object.calls].flatMap(handlesIn);
    case 'execution':
      return object.frames.flatMap(frameReferences);
    default: {
      const unhandled: never = object;
      return unhandled;
    }
  }
}

function futureReferences(
  state: Extract<HeapObject, { kind: 'future' }>['state'],
): readonly number[] {
  switch (state.kind) {
    case 'resolved':
      return handlesIn(state.value);
    case 'call':
    case 'disposing':
      return [state.execution];
    case 'slot':
      return [state.slot, ...optionalHandles(state.value)];
    case 'disposed':
      return [state.target];
    case 'timer':
    case 'host':
      return [];
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}

function frameReferences(frame: Frame): readonly number[] {
  const inRegisters = frame.registers.flatMap(([, contents]) =>
    isReference(contents)
      ? [
          contents.cell,
          ...contents.path.flatMap((step) => (step.kind === 'element' ? handlesIn(step.key) : [])),
        ]
      : handlesIn(contents),
  );
  return [...inRegisters, ...frame.kept.flatMap(handlesIn)];
}

function optionalHandles(slotValue: Value | undefined): readonly number[] {
  return slotValue === undefined ? [] : handlesIn(slotValue);
}
