/**
 * Types computed from others (§5.2, §8.1, §4.6), opaque until what they are built from is known:
 * an associated type, a field's type, a struct's keys, a mapped struct type and a type `match`'s
 * use, each reduced by the program's rules (type-rules.ts) once an instantiation allows; and the
 * recursive types, which are known: a node of a cyclic graph (§4.6), and a type `match` use
 * reached again while it reduces, standing for the shape it reduces to.
 */

import type {
  AliasDeclaration,
  AssociatedType,
  TypeParameter,
} from '../../../syntax/declarations/index.ts';
import type { RestPattern } from '../../../syntax/patterns.ts';
import type { StructType } from '../../../syntax/types/index.ts';
import type { RecursiveLabel } from './alias-uses.ts';
import type {
  FieldMember,
  NominalEntity,
  NominalType,
  Type,
  TypeParameterType,
  WrittenThrough,
} from './index.ts';

/**
 * `T.Data` (§5.2): the associated type `name` of `of`, a type not known yet, a type parameter or
 * another such type. Opaque (§8.1): equal only to itself, it meets what its trait requires of it
 * (`type Data is C`). An instantiation that makes `of` known reduces it to that type's own
 * associated type (TypeRules), so lowering never meets one.
 */
export interface AssociatedOfType extends WrittenThrough {
  readonly kind: 'associated';
  readonly of: Type;
  readonly name: string;
}

/** The associated type `name` a nominal type's own declaration declares (§5.2); else undefined. */
export function ownAssociatedType(owner: NominalType, name: string): AssociatedType | undefined {
  return owner.entity.declaration.associatedTypes.find((each) => each.name.text === name);
}

/**
 * `S["meta"]` (§8.1, §10.2): the type of the field `key` names in `of`, a struct type not known
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
 * `without` names, in name order (§5.2, §8.1): opaque until `of` is known. `keyof S` is this beside
 * the literals its constraints name, so a written key fits it as a union member does; the keys of
 * a field loop's other fields, a rest's and a mapped entry's are this with more names left out.
 */
export interface KeysType extends WrittenThrough {
  readonly kind: 'keys';
  readonly of: Type;
  readonly without: readonly string[];
}

/**
 * A mapped struct type (§5.2) whose `keys` aren't all known yet: its `named` fields, in name
 * order, and a field of the type `value` for each key, `parameter` standing for that key in it.
 * Once the keys are String literals it is the shape of those fields (TypeRules), written at
 * `origin`; until then it is opaque, equal to another only up to the name of its parameter. A
 * struct pattern's rest is one, written at the rest: `{ [F in keyof S except …]: S[F] }` (§11.3).
 */
export interface MappedType extends WrittenThrough {
  readonly kind: 'mapped';
  readonly origin: StructType | RestPattern;
  readonly named: readonly FieldMember[];
  readonly parameter: TypeParameter | RestPattern;
  readonly keys: Type;
  readonly value: Type;
}

/**
 * A use of an alias or associated type whose body is a type `match` (§4.6), not reduced: its
 * arguments hold types not known yet, and its first case that could match doesn't match whatever
 * they become. Opaque, equal only to the same alias with the same arguments; an instantiation
 * reduces it (TypeRules), so lowering never meets one.
 */
export interface MatchType extends WrittenThrough {
  readonly kind: 'match';
  readonly declaration: AliasDeclaration;
  readonly arguments: readonly Type[];
  /** The type declaring an associated type, whose use reads through it, `Bad<T>.Data` (§5.2). */
  readonly owner?: NominalEntity | undefined;
}

/** What a mapped struct type is built from (`MappedType`), reduced or not. */
export type MappedParts = Omit<MappedType, 'kind' | 'alias'>;

/** A type computed from others, opaque until they are known (§8.1): reduced by TypeRules. */
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

/**
 * What decides the type `type` reduces to: a mapped type's keys, its value type only filling the
 * fields they give; any other computed type whole.
 */
export function formDecidedBy(type: ComputedType): Type {
  return type.kind === 'mapped' ? type.keys : type;
}

/**
 * Whether `type` is known only per instantiation: a type parameter, or computed from one (§8.1).
 */
export function isOpaque(type: Type): type is TypeParameterType | ComputedType {
  return type.kind === 'parameter' || isComputed(type);
}

/**
 * A recursive type (§4.6): a node of an immutable, minimized cyclic graph whose nodes are ordinary
 * types, a recursive type of the same graph standing wherever a node is reached again. Its identity
 * is its structure (equi-recursive): two graphs whose nodes unfold alike are one type, whatever
 * aliases wrote them, so its key is its graph's canonical spelling (identity/type-keys.ts). It
 * stands for what it unfolds to, its node's body (`unfoldRecursive`); no fold or unfold is ever
 * written. Only closing a group of bodies builds one (identity/recursive-types.ts
 * `closeRecursive`): a recursive alias's group, or the recursive uses of type `match`es a reduction
 * reaches (resolution/type-matches/type-matches.ts).
 */
export interface RecursiveType extends WrittenThrough {
  readonly kind: 'recursive';
  readonly graph: RecursiveGraph;
  readonly node: number;
}

/**
 * The nodes of a recursive type's graph: each one's body, the node as a recursive type (`types`,
 * the one object standing for it inside every body), and the alias it reads as, which messages and
 * hovers print and which identifies nothing; a node no alias wrote has none.
 */
export interface RecursiveGraph {
  readonly nodes: readonly Type[];
  readonly types: readonly RecursiveType[];
  readonly labels: readonly (RecursiveLabel | undefined)[];
}

/** What the recursive type `type` stands for (§4.6): its node's body. */
export function unfoldRecursive(type: RecursiveType): Type {
  return type.graph.nodes[type.node] ?? type;
}

/**
 * `type`, as a value of it is built and taken apart: what a recursive type unfolds to (§4.6), the
 * same type by identity; any other type as it is.
 */
export function unfolded(type: Type): Type {
  return type.kind === 'recursive' ? unfoldRecursive(type) : type;
}

/** Whether `declaration`'s body is a type `match`, whose uses reduce rather than unfold (§4.6). */
export function isMatchAlias(declaration: AliasDeclaration): boolean {
  return declaration.type.kind === 'TypeMatch';
}
