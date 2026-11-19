/**
 * Whether a field a type gives has a default (§5.2), which a literal may then leave out: one home,
 * so a literal of the struct and a `struct{…}` settling on it (types/inference/system-reading.ts
 * `takesShape`) agree on which fields it must give.
 */

import { hasDefault } from '../../../syntax/declarations/index.ts';
import type { FieldMember } from './index.ts';

/** Whether `field` declares a default (§5.2), as only a declared struct's or variant's can. */
export function declaresDefault(field: FieldMember | undefined): boolean {
  const declared = field?.declared?.node;
  return declared !== undefined && hasDefault(declared);
}
