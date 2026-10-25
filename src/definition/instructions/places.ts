/**
 * Places: a register, optionally followed by a path of field positions into its value. A place is
 * what `&` refers to and what `store` writes (spec §3.7); a tuple element is a field by position,
 * as `field` reads it.
 *
 * An indexed element is no step of a place: lowering reads it with its container's `index` into a
 * register of its own, and writes it back with `setIndex` once changed (docs/arch/definition.md,
 * "Places"). Following a path therefore never runs code, and every call the program makes is a
 * `call` instruction.
 */

import { z } from 'zod';
import { fieldIndex, register } from '../operands.ts';

/** Field positions into a value, outermost first; also a live reference's path (snapshot/objects.ts). */
export const fieldPath = z.array(fieldIndex);

export const place = z.strictObject({ register, path: fieldPath });

export type Place = z.output<typeof place>;

/** A call argument: a value, copied into the callee, or a place passed by `&`. */
export const argument = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('value'), register }),
  z.strictObject({ kind: z.literal('reference'), place }),
]);

export type Argument = z.output<typeof argument>;
