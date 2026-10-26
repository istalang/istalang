/**
 * Type nodes: what may follow `:` in a declaration, or sit between `<…>` (spec §2, §3).
 *
 * A NamedType is a possibly qualified name with type arguments: `int`, `Self`, `Pair<A, B>`,
 * `time.Duration`. Whether the name exists and what it means is the checker's business. The
 * struct type keeps no record of whether `struct` was written before `{`, because the spec makes
 * the two spellings the same type and lets the formatter pick one (§3.1). The indented field block
 * under a struct field is sugar for the same type, and is a StructType too.
 */

import type { Annotatable } from './annotations.ts';
import type { Expression } from './expressions.ts';
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
  readonly parameters: readonly TypeNode[];
  readonly returnType: TypeNode | undefined;
}

/** An anonymous struct: `{ sku: string; qty: int }` or `struct { … }`. */
export interface StructType extends NodeOf<'StructType'> {
  readonly fields: readonly (FieldDeclaration | Invalid)[];
}

/**
 * `name: Type`, and in a struct's or a variant's declaration `name: Type = default` or
 * `name = default`, whose type its default gives (§3.1).
 */
export interface FieldDeclaration extends NodeOf<'FieldDeclaration'>, Annotatable {
  readonly name: Identifier;
  /** Undefined only beside a default, which gives the type. */
  readonly type: TypeNode | undefined;
  readonly defaultValue: Expression | undefined;
}

/** `&T`, valid only as a parameter's type (§3.7). */
export interface ReferenceType extends NodeOf<'ReferenceType'> {
  readonly referent: TypeNode;
}

export type TypeNode =
  | NamedType
  | OptionalType
  | TupleType
  | ParenthesizedType
  | FunctionType
  | StructType
  | ReferenceType
  | Missing
  | Invalid;

/** Nodes that occur only as parts of a type. */
export type TypePart = FieldDeclaration;
