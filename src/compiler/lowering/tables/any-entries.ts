/**
 * An `any` type's entry while lowering runs (§3.10): the types converted into it so far, in the
 * order of their names, their table keys, each with how the Definition refers to it. Its enum, a
 * variant per member holding its value in the one field, is built from it once lowering has
 * reached every conversion (tables.ts).
 */

import type { TypeDefinition, TypeReference } from '../../../definition/tables/types.ts';
import { unionLayout } from '../../../foundation/language/well-known/variants.ts';
import type { Type } from '../../checker/types/type/index.ts';

/**
 * An `any` type's entry while lowering runs: the types converted into it so far, ordered by name,
 * each with how the Definition refers to it, from which its enum is built (`anyEnum`).
 */
export interface AnyEntry {
  readonly kind: 'any';
  readonly name: string;
  readonly disposable: boolean;
  readonly members: {
    readonly type: Type;
    readonly name: string;
    readonly reference: TypeReference;
  }[];
}

/** The enum entry `entry` stands for: one variant per member, holding its value. */
export function anyEnum(entry: AnyEntry): TypeDefinition {
  const variants = entry.members.map(({ name, reference }) => ({
    name,
    fields: [{ name: unionLayout.valueField, type: reference, annotations: [] }],
  }));
  return {
    kind: 'enum',
    name: entry.name,
    arguments: [],
    variants,
    disposable: entry.disposable,
    heap: true,
  };
}
