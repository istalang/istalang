/**
 * Where a custom zod schema, which has no shape to walk, declares the Avro primitive it is written
 * as, so the walk (index.ts) derives its form like any other's.
 */

import { z } from 'zod';
import type { ZodSchema } from './avsc-types.ts';

/** The Avro primitive a custom zod schema is written as. */
export type AvroPrimitive = 'boolean' | 'long' | 'double' | 'string';

export const avroForms = z.registry<{ readonly avro: AvroPrimitive }>();

/** The Avro primitive custom `schema` declared; throws where it declared none. */
export function customForm(schema: ZodSchema): AvroPrimitive {
  const form = avroForms.get(schema);
  if (form === undefined) {
    throw new TypeError('A custom zod schema has no Avro form until it declares one (avroForms).');
  }
  return form.avro;
}
