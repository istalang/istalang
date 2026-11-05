/**
 * Types computed from others (§3.1, §3.5, §3.17), opaque until what they are built from is known:
 * an associated type, a field's type, a struct's keys, a mapped struct type and a type `match`'s
 * use, each reduced by the program's rules (type-rules.ts) once an instantiation allows; and a
 * recursive alias use, which is known, standing for what it unfolds to: an alias's body, or the
 * shape a type `match` reduces to, with the use inside it again.
 */

import type { AliasDeclaration, AssociatedType, TypeParameter } from '../../syntax/declarations.ts';
import type { RestPattern } from '../../syntax/patterns.ts';
import type { StructType } from '../../syntax/types.ts';
import type {
  FieldMember,
  NominalType,
  RecursiveUse,
  Type,
  TypeParameterType,
  WrittenThrough,
} from './type.ts';

/**
 * `T.Data` (§3.1): the associated type `name` of `of`, a type not known yet, a type parameter or
 * another such type. Opaque (§3.5): equal only to itself, it meets what its trait requires of it
 * (`type Data is C`). An instantiation that makes `of` known reduces it to that type's own
 * associated type (TypeRules), so lowering never meets one.
 */
export interface AssociatedOfType extends WrittenThrough {
  readonly kind: 'associated';
  readonly of: Type;
  readonly name: string;
}

/** The associated type `name` a nominal type's own declaration declares (§3.1); else undefined. */
export function ownAssociatedType(owner: NominalType, name: string): AssociatedType | undefined {
  const { declaration } = owner.entity;
  return declaration.kind === 'ExternStructDeclaration'
    ? undefined
    : declaration.associatedTypes.find((each) => each.name.text === name);
}

/**
 * `S["meta"]` (§3.5, §3.9): the type of the field `key` names in `of`, a struct type not known
 * yet, such as a type parameter with a struct constraint. Opaque until an instantiation makes `of`
 * known (TypeRules): equal only to itself, it meets what the constraint's entry for that field
 * requires. A known struct's is its field's type.
 */
export interface FieldOfType extends WrittenThrough {
  readonly kind: 'field';
  readonly of: Type;
  readonly key: Type;
}

/**
 * The keys of `of`, a struct type not known yet, that its struct constraints don't name, less those
 * `without` names, in name order (§3.1, §3.5): opaque until `of` is known. `keyof S` is this beside
 * the literals its constraints name, so a written key fits it as a union member does; the keys of
 * a field loop's other fields, a rest's and a mapped entry's are this with more names left out.
 */
export interface KeysType extends WrittenThrough {
  readonly kind: 'keys';
  readonly of: Type;
  readonly without: readonly string[];
}

/**
 * A mapped struct type (§3.1) whose `keys` aren't all known yet: its `named` fields, in name
 * order, and a field of the type `value` for each key, `parameter` standing for that key in it.
 * Once the keys are String literals it is the shape of those fields (TypeRules), written at
 * `origin`; until then it is opaque, equal to another only up to the name of its parameter. A
 * struct pattern's rest is one, written at the rest: `{ [F in keyof S except …]: S[F] }` (§3.11).
 */
export interface MappedType extends WrittenThrough {
  readonly kind: 'mapped';
  readonly origin: StructType | RestPattern;
  readonly named: readonly FieldMember[];
  readonly parameter: TypeParameter | RestPattern;
  readonly keys: Type;
  readonly value: Type;
  /** The type `match` use that reduced to this mapped type while its arguments were opaque. */
  readonly recursion?: RecursiveUse | undefined;
}

/**
 * A use of an alias or associated type whose body is a type `match` (§3.17), not reduced: its
 * arguments hold types not known yet, and its first case that could match doesn't match whatever
 * they become. Opaque, equal only to the same alias with the same arguments; an instantiation
 * reduces it (TypeRules), so lowering never meets one.
 */
export interface MatchType extends WrittenThrough {
  readonly kind: 'match';
  readonly declaration: AliasDeclaration;
  readonly arguments: readonly Type[];
}

/** What a mapped struct type is built from (`MappedType`), reduced or not. */
export type MappedParts = Omit<MappedType, 'kind' | 'alias' | 'recursion'>;

/** A type computed from others, opaque until they are known (§3.5): reduced by TypeRules. */
export type ComputedType = AssociatedOfType | FieldOfType | KeysType | MappedType | MatchType;

/** Whether `type` is computed from types not known yet, so only an instantiation reduces it. */
export function isComputed(type: Type): type is ComputedType {
  return (
    type.kind === 'associated' ||
    type.kind === 'field' ||
    type.kind === 'keys' ||
    type.kind === 'mapped' ||
    type.kind === 'match'
  );
}

/** Whether `type` is known only per instantiation: a type parameter, or computed from one (§3.5). */
export function isOpaque(type: Type): type is TypeParameterType | ComputedType {
  return type.kind === 'parameter' || isComputed(type);
}

/**
 * A use of an alias that reaches itself (§3.17), as a recursive struct refers to itself: one type,
 * known, its identity the alias and its arguments (iso-recursive). It stands for what it unfolds to
 * (type-rules.ts `unfold`): the alias's body with this use inside it again, or the shape a type
 * `match` alias reduces to. A shape or a union it unfolds to carries the same identity
 * (`recursion`), so the two are one type; no fold or unfold is ever written.
 */
export interface RecursiveType extends WrittenThrough {
  readonly kind: 'recursive';
  readonly declaration: AliasDeclaration;
  readonly arguments: readonly Type[];
}

/** Whether `declaration`'s body is a type `match`, whose uses reduce rather than unfold (§3.17). */
export function isMatchAlias(declaration: AliasDeclaration): boolean {
  return declaration.type.kind === 'TypeMatch';
}

/** What `body` stands for as the unfolding of `use`: a shape or a union with its identity. */
export function withRecursion(body: Type, use: RecursiveUse): Type {
  return body.kind === 'anonymous' || body.kind === 'union' ? { ...body, recursion: use } : body;
}
