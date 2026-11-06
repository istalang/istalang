/**
 * What building a type needs of the program it belongs to (§2, §3.5): the rules types/ can't
 * judge alone, since they look at declarations, conformance among them, which resolution/ owns
 * above this layer. The checker implements them once (program-checker.ts) and hands them to every
 * constructor that needs them, so a type is normalized alike however it was reached: written,
 * substituted, joined by inference, made optional or widened.
 *
 * - The rules are passed where a type is built, never stored in what describes one: a type or a
 *   substitution is data a later checker may take over (structures/entries/), while the rules
 *   answer for the program of the checker building it.
 * - A type computed from others (`T.Data`, `S["meta"]`, §3.5) is reduced here once its parts
 *   allow, so substituting a type parameter in one gives the type it then names.
 * - A rule may need types built by the same rules (conformance substitutes signatures, which may
 *   hold the very union being normalized), so the checker answers each question once per key and a
 *   question reached again while it is answered takes a stand-in (structures/entries/).
 */

import type { AliasDeclaration } from '../../syntax/declarations.ts';
import type { MappedParts } from './computed-types.ts';
import type { AnyType, ParameterKey, Type } from './type/index.ts';

/** The rules of the program building a type that types/ sits below. */
export interface TypeRules {
  /**
   * Whether the `any` type `target`, a member of a union, takes `member` whole (§2 "Collapse"):
   * a value of `member` meets every constraint of `target`.
   */
  readonly absorbs: (target: AnyType, member: Type) => boolean;
  /**
   * The associated type `name` of `of` (§3.1): a known type's own, substituted and written through
   * it; on a type not known yet, the opaque type naming it (`AssociatedOfType`), when one of its
   * constraints requires it; the error type when `of` has none.
   */
  readonly associatedType: (of: Type, name: string) => Type;
  /**
   * The type of the field `key` names in `of` (§3.5): a known struct's field's, a struct type
   * not known yet's opaque `FieldOfType`; the error type when `of` has no such field.
   */
  readonly fieldType: (of: Type, key: Type) => Type;
  /**
   * The keys of `of` but those `without` names (§3.1): a known struct type's field names as a union
   * of String literals, `Never` for none; a struct type not known yet's, the literals its
   * constraints name beside the opaque `KeysType` of the others; the error type for no struct.
   */
  readonly keysOf: (of: Type, without: readonly string[]) => Type;
  /**
   * The mapped struct type of `parts` (§3.1), its value read through `outer` too: once its keys
   * are String literals, the shape of its named fields and one per key, the key and `outer`
   * replaced in the value together; else the opaque `MappedType`.
   */
  readonly mappedType: (parts: MappedParts, outer?: ReadonlyMap<ParameterKey, Type>) => Type;
  /**
   * The use of `declaration`, an alias or associated type whose body is a type `match`, with
   * `typeArguments` (§3.17): the type of the first case matching its subject, unions distributed;
   * the opaque `MatchType` while that case isn't decided by what is known yet; the error type when
   * no case matches.
   */
  readonly matchType: (declaration: AliasDeclaration, typeArguments: readonly Type[]) => Type;
  /** Whether every key `key` may be names a field of `of`, as a written `S[K]` must (§3.1). */
  readonly isKeyOf: (key: Type, of: Type) => boolean;
}
