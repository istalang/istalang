/**
 * Places: a register, optionally followed by a path into its value. A place is what `&` refers to
 * and what an assignment writes (spec §3.7, §3.9).
 *
 * A path step is a field, or an element of an indexable value. An element step names the `index`
 * and `setIndex` functions the checker resolved for its container, so the runtime reads and
 * writes any indexable place the same way, whether the container is a built-in Array or Map or a
 * user type. Writing an element replaces it through `setIndex`, so the write is atomic within the
 * segment (docs/arch/definition.md, "Places").
 */

import { z } from 'zod';
import { fieldIndex, functionId, register } from '../operands.ts';

/**
 * One step into a value: a field, or an element through its container's `index` and `setIndex`.
 * The key is a register in code and a value in a snapshot's live reference
 * (runtime/snapshot/objects.ts); the step is otherwise the same, so both build it here.
 */
export function pathStep<Key extends z.ZodType>(key: Key) {
  return z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('field'), index: fieldIndex }),
    z.strictObject({ kind: z.literal('element'), key, read: functionId, write: functionId }),
  ]);
}

export const place = z.strictObject({ register, path: z.array(pathStep(register)) });

export type Place = z.output<typeof place>;

/** A call argument: a value, copied into the callee, or a place passed by `&`. */
export const argument = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('value'), register }),
  z.strictObject({ kind: z.literal('reference'), place }),
]);

export type Argument = z.output<typeof argument>;
