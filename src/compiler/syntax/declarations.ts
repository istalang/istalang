/**
 * Top-level declarations and the module (§3, §3.13).
 *
 * The tree keeps each declaration form apart where the forms hold different things, so a consumer
 * never meets a combination the syntax can't produce:
 * - An extern struct has no fields, and may say `sendable`, so it has its own kind instead of a
 *   flag on StructDeclaration. A shared struct has its own kind too: its type is a handle, not
 *   its fields.
 * - An extern constant has a type and no value, unlike a `const`.
 * - The two import forms bind different things.
 *
 * A function stays one kind, extern or not, because its signature is the same either way. Only
 * its body differs, and an extern function never has one: the parser reports any it finds.
 *
 * Module items are declarations only. A statement written at the top level is reported and kept
 * as an Invalid node, so a tree never holds a top-level statement.
 */

import { receiverParameter } from '../../language/well-known.ts';
import type { Annotatable } from './annotations.ts';
import type { Expression, Parameter, StringLiteral } from './expressions/index.ts';
import type { Identifier, Invalid, Missing, NodeOf } from './node.ts';
import type { Block, VariableDeclaration } from './statements.ts';
import type { FieldDeclaration, TypeNode } from './types.ts';

/** `"""…"""`: what a declaration or module is for, in its own words (§2); tools read it. */
export interface Docstring extends NodeOf<'Docstring'> {
  readonly value: string;
}

/** What a docstring may describe; the field is absent without one. */
export interface Documented {
  readonly doc?: Docstring;
}

/** `T`, `T is Sendable & Comparable`, `E = Error`, and `...A`, a pack of types (§3.5). */
export interface TypeParameter extends NodeOf<'TypeParameter'> {
  readonly isPack: boolean;
  readonly name: Identifier;
  readonly constraints: readonly TypeNode[];
  readonly defaultType: TypeNode | undefined;
}

export type TypeParameters = readonly (TypeParameter | Invalid)[];

/** The type parameters a declaration introduces, leaving out what the parser couldn't read. */
export function typeParametersOf(parameters: TypeParameters): readonly TypeParameter[] {
  return parameters.filter((parameter) => parameter.kind === 'TypeParameter');
}

/**
 * A function: top-level, local, a trait's requirement, or extern. `owner` is the type a static
 * function is declared on: `Duration` in `fn Duration.zero()`.
 */
export interface FunctionDeclaration
  extends NodeOf<'FunctionDeclaration'>,
    Annotatable,
    Documented {
  readonly isExtern: boolean;
  readonly isAsync: boolean;
  readonly owner: Identifier | undefined;
  readonly name: Identifier;
  readonly typeParameters: TypeParameters;
  readonly parameters: readonly (Parameter | Invalid)[];
  readonly returnType: TypeNode | undefined;
  readonly body: Block | undefined;
}

/** Whether `declaration` is a method: its first parameter is named `self` (§3.7). */
export function isMethod(declaration: FunctionDeclaration): boolean {
  const [first] = declaration.parameters;
  return first?.kind === 'Parameter' && first.name.text === receiverParameter;
}

/** What a struct's declaration holds, shared or not: its name, type parameters and fields (§3.1). */
interface StructOf<Kind extends string> extends NodeOf<Kind>, Annotatable, Documented {
  readonly name: Identifier;
  readonly typeParameters: TypeParameters;
  readonly fields: readonly (DeclaredField | Invalid)[];
}

/** `struct Pair: …`: a value type made of its fields (§3.1). */
export type StructDeclaration = StructOf<'StructDeclaration'>;

/**
 * `shared struct Inbox<T>: …`: its values are handles to a cell holding its fields, built with
 * `new` and read through with `*` and `->` (§3.18), so its type has no fields of its own.
 */
export type SharedStructDeclaration = StructOf<'SharedStructDeclaration'>;

/** A struct a program declares with its fields, shared or not. */
export type DeclaredStruct = StructDeclaration | SharedStructDeclaration;

/** Whether `declaration` declares a struct with its fields, shared or not. */
export function isDeclaredStruct(
  declaration: Declaration | DeclarationPart,
): declaration is DeclaredStruct {
  return declaration.kind === 'StructDeclaration' || declaration.kind === 'SharedStructDeclaration';
}

/**
 * A field of a struct's or a variant's declaration: `name: Type`, `name: Type = default`, or
 * `name = default`, whose type its default gives (§3.1). Only these fields have defaults, so they
 * are a kind of their own beside a type's or a trait's `FieldDeclaration`.
 */
export interface DeclaredField extends NodeOf<'DeclaredField'>, Annotatable {
  readonly name: Identifier;
  /** Undefined only beside a default, which gives the type. */
  readonly type: TypeNode | undefined;
  readonly defaultValue: Expression | undefined;
}

/** A field anywhere: of a struct's or a variant's declaration, an anonymous struct type or a trait. */
export type Field = DeclaredField | FieldDeclaration;

/** Whether `field` has a default: only a struct's or a variant's field may (§3.1). */
export function hasDefault(field: Field | Invalid): boolean {
  return field.kind === 'DeclaredField' && field.defaultValue !== undefined;
}

/** `extern sendable struct Queue<T>`: a struct the host implements. */
export interface ExternStructDeclaration
  extends NodeOf<'ExternStructDeclaration'>,
    Annotatable,
    Documented {
  readonly isSendable: boolean;
  readonly name: Identifier;
  readonly typeParameters: TypeParameters;
}

/** `extern approvalDeadline: Duration`: a value the host provides. */
export interface ExternConstantDeclaration
  extends NodeOf<'ExternConstantDeclaration'>,
    Annotatable {
  readonly name: Identifier;
  readonly type: TypeNode;
}

export interface EnumDeclaration extends NodeOf<'EnumDeclaration'>, Annotatable, Documented {
  readonly name: Identifier;
  readonly typeParameters: TypeParameters;
  readonly variants: readonly (Variant | Invalid)[];
}

/** `Expired`, or `Rejected { by: string; reason: string }`. */
export interface Variant extends NodeOf<'Variant'>, Annotatable {
  readonly name: Identifier;
  readonly fields: readonly (DeclaredField | Invalid)[];
}

/** Required functions (with no body) and fields (§3.10). */
export interface TraitDeclaration extends NodeOf<'TraitDeclaration'>, Annotatable, Documented {
  readonly name: Identifier;
  readonly typeParameters: TypeParameters;
  readonly members: readonly (FunctionDeclaration | FieldDeclaration | Invalid)[];
}

export interface TypeAliasDeclaration extends NodeOf<'TypeAliasDeclaration'>, Annotatable {
  readonly name: Identifier;
  readonly typeParameters: TypeParameters;
  readonly type: TypeNode;
}

/** `import a, b from 'path'`. */
export interface NamedImport extends NodeOf<'NamedImport'>, Annotatable {
  readonly names: readonly Identifier[];
  readonly path: StringLiteral | Missing;
}

/** `import * as m from 'path'`. */
export interface NamespaceImport extends NodeOf<'NamespaceImport'>, Annotatable {
  readonly alias: Identifier;
  readonly path: StringLiteral | Missing;
}

export type ImportDeclaration = NamedImport | NamespaceImport;

/** A top-level `const`: the one kind of variable a module may declare (§3). */
export type ConstantDeclaration = VariableDeclaration & {
  readonly isMutable: false;
  readonly hold: undefined;
};

export type Declaration =
  | ImportDeclaration
  | StructDeclaration
  | SharedStructDeclaration
  | ExternStructDeclaration
  | ExternConstantDeclaration
  | EnumDeclaration
  | TraitDeclaration
  | TypeAliasDeclaration
  | FunctionDeclaration
  | ConstantDeclaration;

/** One source file. Its span is the whole text. */
export interface Module extends NodeOf<'Module'>, Documented {
  readonly items: readonly (Declaration | Invalid)[];
}

/** The top-level functions `module` declares, static ones included. */
export function declaredFunctions(module: Module): readonly FunctionDeclaration[] {
  return module.items.filter((item) => item.kind === 'FunctionDeclaration');
}

/** Nodes that occur only as parts of a declaration. */
export type DeclarationPart = TypeParameter | Variant | DeclaredField | Docstring;
