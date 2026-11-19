/**
 * How a type was written where it isn't spelled as itself (§5.2, §4.6): through an alias, an
 * associated type or a struct's keys. An alias names no type of its own: a type written through one
 * carries it (type/index.ts `WrittenThrough`) only so its text can read as written
 * (`Entries<Int>`), which messages and hovers show. An associated type on a known type is such an
 * alias too (`Field<Int>.Data`), whose spelling also keeps inference from looking through it
 * (§8.1); on a type not known yet, it is a type of its own, opaque (`AssociatedOfType`). Exact
 * relations and type keys look through it. Only substitution keeps it, substituting its arguments
 * too (`mapAliasUse`), since that rewrites the alias's own parameters alike; any other change of a
 * type leaves a type the alias didn't write, so widening, the one other, drops it.
 */

import { sameItems } from '../../../../foundation/structures/equality.ts';
import type { TypeAliasDeclaration } from '../../../syntax/declarations/index.ts';
import type { Type } from './index.ts';

/** The alias a type was written through, with the arguments it was given there (§4.6). */
export interface DeclaredAliasUse {
  readonly kind: 'alias';
  readonly declaration: TypeAliasDeclaration;
  readonly arguments: readonly Type[];
}

/**
 * The associated type `name` of `of` a type was written as, `Field<T>.Data` (§5.2): the same type
 * as what it names, which inference never looks through (§8.1).
 */
export interface AssociatedUse {
  readonly kind: 'associated';
  readonly of: Type;
  readonly name: string;
}

/**
 * The keys of the struct `of` a union of String literals was written as, `keyof Settings` (§5.2
 * Key types): the same type as the union, whose literals name `of`'s fields, which tools read.
 */
interface KeysUse {
  readonly kind: 'keys';
  readonly of: Type;
}

/**
 * How a type was written where it isn't spelled as itself: through an alias, an associated type or
 * a struct's keys.
 */
export type AliasUse = DeclaredAliasUse | AssociatedUse | KeysUse;

/**
 * How a recursive type's node reads (§4.6): the alias it was written through, or, for a recursive
 * type `match` use an associated type stands for, that associated type, `Group<Category>.Data`.
 */
export type RecursiveLabel = DeclaredAliasUse | AssociatedUse;

/** `type` as written through `alias`; the error type stays itself, as a diagnostic explained it. */
export function aliasedAs<Aliased extends Type>(type: Aliased, alias: AliasUse): Aliased {
  return type.kind === 'error' ? type : { ...type, alias };
}

/**
 * `use` with each type it names replaced by what `map` gives; `use` itself when `map` changes none.
 */
export function mapAliasUse<Use extends AliasUse>(use: Use, map: (type: Type) => Type): Use;
export function mapAliasUse(use: AliasUse, map: (type: Type) => Type): AliasUse {
  if (use.kind === 'alias') {
    const given = use.arguments.map(map);
    return sameItems<Type>()(given, use.arguments) ? use : { ...use, arguments: given };
  }
  const of = map(use.of);
  return of === use.of ? use : { ...use, of };
}
