/**
 * The shape every instruction shares: a `kind`, and the span of source it was lowered from, for
 * traces, panics and the operator's view of where an instance waits.
 */

import { z } from 'zod';
import { span } from '../operands.ts';

/** An instruction schema: `kind` and `span`, plus its own operands. */
export function defineInstruction<const Kind extends string, Shape extends z.ZodRawShape>(
  kind: Kind,
  shape: Shape,
) {
  return z.strictObject({ kind: z.literal(kind), span, ...shape });
}
