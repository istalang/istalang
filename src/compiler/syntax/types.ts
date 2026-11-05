/**
 * Type nodes: what may follow `:` in a declaration, or sit between `<…>` (spec §2, §3).
 *
 * A NamedType is a possibly qualified name with type arguments: `Int`, `Self`, `Pair<A, B>`,
 * `time.Duration`. A path may go on past the type it names with the type's associated types,
 * `T.Data`, which the binder leaves to the checker as an expression's members are; after type
 * arguments or parentheses, `Field<Int>.Data` is a MemberType. Whether the name exists and what it
 * means is the checker's business, and so
 * is what a union written with nested or repeated members normalizes to: the tree keeps the
 * members as written. A literal type holds the literal as an expression writes it, a negative
 * integer included, so a literal reads alike wherever it stands. The
 * struct type keeps no record of whether `struct` was written before `{`, because the spec makes
 * the two spellings the same type and lets the formatter pick one (§3.1). The indented field block
 * under a struct field is sugar for the same type, and is a StructType too.
 */

import type { Annotatable } from './annotations.ts';
import type { Literal, Unary } from './expressions/index.ts';
import type { Identifier, Invalid, Missing, NodeOf, QualifiedName } from './node.ts';

export interface NamedType extends NodeOf<'NamedType'> {
  readonly path: QualifiedName;
  readonly typeArguments: readonly TypeNode[];
}

/** `T?`, sugar for `Optional<T>`. */
interface OptionalType extends NodeOf<'OptionalType'> {
  readonly inner: TypeNode;
}

/** `(A, B)`, `(A,)`, and `()` for unit. */
interface TupleType extends NodeOf<'TupleType'> {
  readonly elements: readonly TypeNode[];
}

interface ParenthesizedType extends NodeOf<'ParenthesizedType'> {
  readonly inner: TypeNode;
}

/**
 * `fn(A) -> R` or `async fn(A)`, either maybe `sendable` (§3.14); an absent return type means
 * unit.
 */
export interface FunctionType extends NodeOf<'FunctionType'> {
  readonly isSendable: boolean;
  readonly isAsync: boolean;
  readonly parameters: readonly (TypeNode | RestType)[];
  readonly returnType: TypeNode | undefined;
}

/** `...A` among a function type's parameters: the rest, an array or a pack (§3.3, §3.5). */
export interface RestType extends NodeOf<'RestType'> {
  readonly type: TypeNode;
}

/** `any T` or `any A & B`: a value of any type conforming to the traits (§3.10). */
interface AnyType extends NodeOf<'AnyType'> {
  readonly traits: readonly TypeNode[];
}

/** An anonymous struct: `{ sku: String; qty: Int }` or `struct { … }`. */
export interface StructType extends NodeOf<'StructType'> {
  readonly fields: readonly (FieldDeclaration | Invalid)[];
}

/** `name: Type`: a field of an anonymous struct type or a trait, which has no default. */
export interface FieldDeclaration extends NodeOf<'FieldDeclaration'>, Annotatable {
  readonly name: Identifier;
  readonly type: TypeNode;
}

/** `A | B`: a value of one of its members, each as written; `|` binds looser than `?` (§2). */
export interface UnionType extends NodeOf<'UnionType'> {
  readonly members: readonly TypeNode[];
}

/** `"draft"`, `42`, `-1`, `true`: the type whose one value the literal writes (§2). */
export interface LiteralType extends NodeOf<'LiteralType'> {
  readonly value: Literal | Unary;
}

/** `&T`, valid only as a parameter's type (§3.7). */
export interface ReferenceType extends NodeOf<'ReferenceType'> {
  readonly referent: TypeNode;
}

/** `node` without the parentheses around it, which only group: `(A)` is `A`. */
export function unparenthesizedType(node: TypeNode): TypeNode {
  return node.kind === 'ParenthesizedType' ? unparenthesizedType(node.inner) : node;
}

export type TypeNode =
  | NamedType
  | OptionalType
  | TupleType
  | ParenthesizedType
  | FunctionType
  | StructType
  | ReferenceType
  | AnyType
  | UnionType
  | LiteralType
  | MemberType
  | Missing
  | Invalid;

/**
 * `Field<Int>.Data`, `(A).Data`: the associated type `name` of `owner` (§3.1), where the owner
 * isn't a plain path, which reaches its associated types as a NamedType's parts.
 */
interface MemberType extends NodeOf<'MemberType'> {
  readonly owner: TypeNode;
  readonly name: Identifier;
}

/**
 * `struct`, `struct { title: String; [_] is FormNode }`: a constraint on a struct's fields (§3.5),
 * met only by a struct type. It is a constraint, never a type, so it stands only where one does:
 * after `is`. Bare `struct` and `struct {}` are the same constraint, any struct.
 */
export interface StructConstraint extends NodeOf<'StructConstraint'> {
  readonly entries: readonly (FieldEntry | Invalid)[];
}

/** `[_]` in a struct constraint: every field the constraint's other entries don't name. */
interface OtherFields extends NodeOf<'OtherFields'> {}

/** What an entry of a struct constraint constrains: one named field, or the others. */
export type EntryField = Identifier | OtherFields;

/** `title: String`, `[_]: Int`: the field, or each other field, has exactly that type. */
interface FieldTypeEntry extends NodeOf<'FieldTypeEntry'> {
  readonly field: EntryField;
  readonly type: TypeNode;
}

/** `meta is struct { tag: String }`, `[_] is A & B`: the field, or each other one, meets each. */
interface FieldConstraintEntry extends NodeOf<'FieldConstraintEntry'> {
  readonly field: EntryField;
  readonly constraints: readonly ConstraintNode[];
}

/** An entry of a struct constraint. */
export type FieldEntry = FieldTypeEntry | FieldConstraintEntry;

/** What stands after `is` (§3.5): a trait, as a type names it, or a struct constraint. */
export type ConstraintNode = TypeNode | StructConstraint;

/** Nodes that occur only as parts of a type or a constraint. */
export type TypePart =
  | FieldDeclaration
  | RestType
  | StructConstraint
  | OtherFields
  | FieldTypeEntry
  | FieldConstraintEntry;

/** A node that writes a type, or a function type's rest: what a type position holds. */
type WrittenType = Exclude<TypeNode, Missing | Invalid> | RestType;

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const writtenTypeKinds = {
  NamedType: true,
  OptionalType: true,
  TupleType: true,
  ParenthesizedType: true,
  FunctionType: true,
  RestType: true,
  StructType: true,
  ReferenceType: true,
  AnyType: true,
  UnionType: true,
  LiteralType: true,
  MemberType: true,
} as const satisfies Record<WrittenType['kind'], true>;
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** Whether `node` writes a type, or a function type's rest; a missing or invalid one doesn't. */
export function isWrittenType(node: { readonly kind: string }): node is WrittenType {
  return Object.hasOwn(writtenTypeKinds, node.kind);
}
