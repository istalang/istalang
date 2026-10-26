/**
 * Top-level declarations and the module (§3, §3.13).
 *
 * The tree keeps each declaration form apart where the forms hold different things, so a consumer
 * never meets a combination the syntax can't produce:
 * - An extern struct has no fields, and may say `sendable`, so it has its own kind instead of a
 *   flag on StructDeclaration.
 * - An extern constant has a type and no value, unlike a `const`.
 * - The two import forms bind different things.
 *
 * A function stays one kind, extern or not, because its signature is the same either way. Only
 * its body differs, and an extern function never has one: the parser reports any it finds.
 *
 * Module items are declarations only. A statement written at the top level is reported and kept
 * as an Invalid node, so a tree never holds a top-level statement.
 */

import type { Annotatable } from './annotations.ts';
import type { Parameter, StringLiteral } from './expressions.ts';
import type { Identifier, Invalid, Missing, NodeOf } from './node.ts';
import type { Block, VariableDeclaration } from './statements.ts';
import type { FieldDeclaration, TypeNode } from './types.ts';

/** `T`, `T is Sendable & Comparable`, `E = Error`. */
export interface TypeParameter extends NodeOf<'TypeParameter'> {
  readonly name: Identifier;
  readonly constraints: readonly TypeNode[];
  readonly defaultType: TypeNode | undefined;
}

export type TypeParameters = readonly (TypeParameter | Invalid)[];

/**
 * A function: top-level, local, a trait's requirement, or extern. `owner` is the type a static
 * function is declared on: `Duration` in `fn Duration.zero()`.
 */
export interface FunctionDeclaration extends NodeOf<'FunctionDeclaration'>, Annotatable {
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
  return first?.kind === 'Parameter' && first.name.text === 'self';
}

export interface StructDeclaration extends NodeOf<'StructDeclaration'>, Annotatable {
  readonly name: Identifier;
  readonly typeParameters: TypeParameters;
  readonly fields: readonly (FieldDeclaration | Invalid)[];
}

/** `extern sendable struct Queue<T>`: a struct the host implements. */
export interface ExternStructDeclaration extends NodeOf<'ExternStructDeclaration'>, Annotatable {
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

export interface EnumDeclaration extends NodeOf<'EnumDeclaration'>, Annotatable {
  readonly name: Identifier;
  readonly typeParameters: TypeParameters;
  readonly variants: readonly (Variant | Invalid)[];
}

/** `Expired`, or `Rejected { by: string; reason: string }`. */
export interface Variant extends NodeOf<'Variant'>, Annotatable {
  readonly name: Identifier;
  readonly fields: readonly (FieldDeclaration | Invalid)[];
}

/** Required functions (with no body) and fields (§3.10). */
export interface TraitDeclaration extends NodeOf<'TraitDeclaration'>, Annotatable {
  readonly name: Identifier;
  readonly typeParameters: TypeParameters;
  readonly members: readonly (FunctionDeclaration | FieldDeclaration | Invalid)[];
}

export interface TypeAliasDeclaration extends NodeOf<'TypeAliasDeclaration'>, Annotatable {
  readonly name: Identifier;
  readonly typeParameters: TypeParameters;
  readonly type: TypeNode;
}

/**
 * `handle Inbox<T> of InboxState<T>`: a type of its own whose values are handles to a cell
 * holding a `state` (§3.18). The functions it declares are read from it (declared-functions.ts).
 */
export interface HandleDeclaration extends NodeOf<'HandleDeclaration'>, Annotatable {
  readonly name: Identifier;
  readonly typeParameters: TypeParameters;
  readonly state: TypeNode;
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
  readonly heldByFunction: false;
};

export type Declaration =
  | ImportDeclaration
  | StructDeclaration
  | ExternStructDeclaration
  | ExternConstantDeclaration
  | EnumDeclaration
  | TraitDeclaration
  | TypeAliasDeclaration
  | HandleDeclaration
  | FunctionDeclaration
  | ConstantDeclaration;

/** One source file. Its span is the whole text. */
export interface Module extends NodeOf<'Module'> {
  readonly items: readonly (Declaration | Invalid)[];
}

/** Nodes that occur only as parts of a declaration. */
export type DeclarationPart = TypeParameter | Variant;
