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
 * its body differs, and an extern function never has one: the parser reports any it finds. The
 * body is not a field: the tree holds it (../tree.ts `bodyOf`), so the declaration's node, and all
 * that is keyed by it, can outlive an edit of the body (docs/work/m6-m7/incremental-checking.md).
 *
 * Module items are declarations only. A statement written at the top level is reported and kept
 * as an Invalid node, so a tree never holds a top-level statement.
 */

import { receiverParameter } from '../../../language/well-known/index.ts';
import type { Annotatable } from '../annotations.ts';
import type { Expression, Parameter } from '../expressions/index.ts';
import type { StringLiteral } from '../expressions/literals/literals.ts';
import type { Identifier, Invalid, Missing, NodeOf } from '../node.ts';
import { type AnchoredSpan, spanAcross } from '../positions.ts';
import type { Block, VariableDeclaration } from '../statements/index.ts';
import type { ConstraintNode, FieldDeclaration, TypeMatch, TypeNode } from '../types/index.ts';

/** `"""…"""`: what a declaration or module is for, in its own words (§2); tools read it. */
export interface Docstring extends NodeOf<'Docstring'> {
  readonly value: string;
}

/** What a docstring may describe; the field is absent without one. */
export interface Documented {
  readonly doc?: Docstring;
}

/**
 * `T`, `T is Sendable & Comparable`, `E = Error`, `...A`, a pack of types, and `S in Status`, a
 * member parameter standing for one member of the union it is `memberOf` (§3.5), which takes no
 * constraint or default beside it (the parser reports one).
 */
export interface TypeParameter extends NodeOf<'TypeParameter'> {
  readonly isPack: boolean;
  readonly name: Identifier;
  readonly memberOf: TypeNode | undefined;
  readonly constraints: readonly ConstraintNode[];
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
}

/**
 * The text a function nested in a body covers, its header and `body`, which share the body's
 * segment; a function's own span covers its header alone (../positions.ts).
 */
export function nestedFunctionSpan(
  declaration: FunctionDeclaration,
  body: Block | undefined,
): AnchoredSpan {
  return body === undefined ? declaration.span : spanAcross(declaration.span, body.span);
}

/** Whether `declaration` is a method: its first parameter is named `self` (§3.7). */
export function isMethod(declaration: FunctionDeclaration): boolean {
  const [first] = declaration.parameters;
  return first?.kind === 'Parameter' && first.name?.text === receiverParameter;
}

/**
 * `type Data = T` in a struct's or an enum's body (§3.1): an alias its type's own type arguments
 * complete, read as `Field<Int>.Data`. The body's fields, variants and other associated types name
 * it bare. It stands among them in any order, but is a member list of its own, since it is neither
 * a field nor a variant.
 */
export interface AssociatedType extends NodeOf<'AssociatedType'>, Annotatable {
  readonly name: Identifier;
  readonly type: AliasBody;
}

/**
 * `type Key is Stringable & Encodable` in a trait (§3.10): a type meeting the trait declares an
 * associated type of that name, meeting each constraint.
 */
export interface RequiredAssociatedType extends NodeOf<'RequiredAssociatedType'>, Annotatable {
  readonly name: Identifier;
  readonly constraints: readonly ConstraintNode[];
}

/**
 * What a struct's declaration holds, shared or not: its name, type parameters, fields (§3.1) and
 * associated types.
 */
interface StructOf<Kind extends string> extends NodeOf<Kind>, Annotatable, Documented {
  readonly name: Identifier;
  readonly typeParameters: TypeParameters;
  readonly fields: readonly (DeclaredField | Invalid)[];
  readonly associatedTypes: readonly AssociatedType[];
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

/**
 * A field anywhere: of a struct's or a variant's declaration, an anonymous struct type or a trait.
 */
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
  readonly associatedTypes: readonly AssociatedType[];
}

/**
 * A declaration standing for a type written beside it: an alias, or an associated type (§3.17,
 * §3.1).
 */
export type AliasDeclaration = TypeAliasDeclaration | AssociatedType;

/** A declaration whose body may declare associated types (§3.1). */
export type AssociatingDeclaration = DeclaredStruct | EnumDeclaration;

/**
 * A struct's or an enum's members as written: its fields or variants and its associated types,
 * in source order, which only reading the text back (formatting, outlines) needs.
 */
export function membersAsWritten(
  declaration: AssociatingDeclaration,
): readonly (DeclaredField | Variant | AssociatedType | Invalid)[] {
  const listed = declaration.kind === 'EnumDeclaration' ? declaration.variants : declaration.fields;
  return [...listed, ...declaration.associatedTypes].toSorted(
    (first, second) => first.span.from - second.span.from,
  );
}

/** `Expired`, or `Rejected { by: String, reason: String }`. */
export interface Variant extends NodeOf<'Variant'>, Annotatable {
  readonly name: Identifier;
  readonly fields: readonly (DeclaredField | Invalid)[];
}

/** What a trait requires: functions (with no body), fields and associated types (§3.10). */
export type TraitMember = FunctionDeclaration | FieldDeclaration | RequiredAssociatedType;

export interface TraitDeclaration extends NodeOf<'TraitDeclaration'>, Annotatable, Documented {
  readonly name: Identifier;
  readonly typeParameters: TypeParameters;
  readonly members: readonly (TraitMember | Invalid)[];
}

export interface TypeAliasDeclaration extends NodeOf<'TypeAliasDeclaration'>, Annotatable {
  readonly name: Identifier;
  readonly typeParameters: TypeParameters;
  readonly type: AliasBody;
}

/** What an alias or an associated type stands for: a type, or a type `match` (§3.17). */
export type AliasBody = TypeNode | TypeMatch;

/**
 * `import a, b as c from 'path'`, or the same names in parentheses, a list that may span lines
 * (§3.13, §2), which the formatter keeps.
 */
export interface NamedImport extends NodeOf<'NamedImport'>, Annotatable {
  readonly names: readonly (ImportedName | Invalid)[];
  readonly isParenthesized: boolean;
  readonly path: StringLiteral | Missing;
}

/** `a` or `a as b` in a named import: the export `name` names, bound as `alias` where renamed. */
export interface ImportedName extends NodeOf<'ImportedName'> {
  readonly name: Identifier;
  readonly alias: Identifier | undefined;
}

/** The name an imported name binds in its module: its alias, or the export's own. */
export function boundName({ name, alias }: ImportedName): Identifier {
  return alias ?? name;
}

/** The names a named import lists, those recovery skipped aside. */
export function importedNames(declaration: NamedImport): readonly ImportedName[] {
  return declaration.names.filter((name) => name.kind === 'ImportedName');
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
export function declaredFunctions(module: Pick<Module, 'items'>): readonly FunctionDeclaration[] {
  return module.items.filter((item) => item.kind === 'FunctionDeclaration');
}

/** Nodes that occur only as parts of a declaration. */
export type DeclarationPart =
  | ImportedName
  | TypeParameter
  | Variant
  | DeclaredField
  | AssociatedType
  | RequiredAssociatedType
  | Docstring;
