/**
 * The roles of type entries (definition/tables/types.ts): the std types the runtime treats by what
 * they are, recognized by their declarations, never by their names. A shared struct's role comes
 * from its declaration's kind instead (§5.4).
 */

import type { EnumRole, ExternRole } from '../../../definition/tables/types.ts';
import {
  type WellKnownDeclaration,
  wellKnown,
} from '../../../foundation/language/well-known/index.ts';
import type { Checker } from '../../checker/check.ts';

/**
 * The std type each role of an extern type entry is (definition/tables/types.ts), so the runtime
 * recognizes none by its name; a shared struct's role comes from its declaration's kind instead
 * (§5.4).
 */
export const externRoles = {
  array: wellKnown.array,
  map: wellKnown.map,
  cell: wellKnown.cell,
  weakRef: wellKnown.weakRef,
  instance: wellKnown.instance,
  call: wellKnown.call,
} as const satisfies Record<ExternRole, WellKnownDeclaration>;

/**
 * The std type each role of an enum entry is (definition/tables/types.ts): `json.Json`, a recursive
 * alias whose union is an enum entry (§4.6).
 */
export const enumRoles = {
  json: wellKnown.json,
} as const satisfies Record<EnumRole, WellKnownDeclaration>;

/** The role `declaration` plays among `roles`, if any. */
export function roleOf<Role extends string>(
  checker: Checker,
  roles: Readonly<Record<Role, WellKnownDeclaration>>,
  declaration: object,
): Role | undefined {
  return (Object.keys(roles) as Role[]).find((role) => {
    const entity = checker.wellKnownEntity(roles[role]);
    return entity !== undefined && 'declaration' in entity && entity.declaration === declaration;
  });
}
