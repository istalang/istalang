/**
 * Instances (§3.5: generics are compiled per instantiation): what one function-table entry is.
 *
 * - An instance is a declaration with concrete type arguments and the concrete witnesses of its
 *   constraints (§3.10). Its entry takes every parameter, computing those a call leaves out from
 *   their defaults in its prologue (§3.1, §3.3), so a function named as a value of a shorter type
 *   is that entry too; only an extern, which computes nothing, has a second entry computing them
 *   (tables.ts).
 * - A body is checked once, generically (checker), so lowering one instance reads the body through
 *   its substitution (checker/wiring/body/facts/instantiation.ts), and closes every call it makes
 *   (../calls/closed-calls.ts). Its defaults are checked apart from its body, in a body of their
 *   own, which its prologue reads (`BodyOwner`).
 * - Two instances are one entry when their key is: the declaration and its arguments' types.
 *   Witnesses are coherent (§3.10), the same for the same types wherever they are found, so the
 *   types decide them.
 * - A lambda or local function (§3.14) is an entry of its own per instance of the top-level
 *   function holding it: it is checked within that body, so it reads the body through the same
 *   substitution, and its key is the instance's plus its node. A lambda in a top-level constant's
 *   value is one entry, owned by the constant, which has no type parameters to substitute.
 */

import type { Checker } from '../../checker/check.ts';
import type { FunctionInstance } from '../../checker/surface/witness-closing.ts';
import type { TypeKeys } from '../../checker/types/identity/type-keys.ts';
import {
  isMarkParameter,
  type QualifierLookup,
  simpleMark,
} from '../../checker/types/type/function-kinds.ts';
import type { FunctionType, Type } from '../../checker/types/type/index.ts';
import type { ModuleId } from '../../program/program.ts';
import {
  type ContextConstantDeclaration,
  type FunctionDeclaration,
  typeParametersOf,
} from '../../syntax/declarations/index.ts';
import type { FieldHeader, Lambda } from '../../syntax/expressions/index.ts';
import type { VariableDeclaration } from '../../syntax/statements/index.ts';
import type { NodeOf } from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import { qualifiedNameOf, tableKey } from './names.ts';

/** A lambda or local function inside one instance of the top-level function holding it. */
export interface NestedInstance {
  readonly owner: BodyOwner;
  readonly node: Lambda | FunctionDeclaration;
}

/**
 * What a lowered body belongs to: an instance of a function, the defaults of one, which its
 * prologue computes (§3.3), a top-level constant's value, or a context constant's initializer, its
 * accessor's (§3.4); and the passes of the field loops it is lowered inside (§4), outermost first,
 * each read as checked.
 */
export type BodyOwner = (
  | { readonly kind: 'function'; readonly instance: FunctionInstance }
  | { readonly kind: 'defaults'; readonly instance: FunctionInstance }
  | { readonly kind: 'constant'; readonly declaration: VariableDeclaration }
  | { readonly kind: 'contextConstant'; readonly declaration: ContextConstantDeclaration }
) & { readonly passes?: readonly FieldPassStep[] };

/** The function instance `owner` belongs to: its body's or its defaults'; none for a constant's. */
export function ownerInstance(owner: BodyOwner): FunctionInstance | undefined {
  return owner.kind === 'constant' || owner.kind === 'contextConstant' ? undefined : owner.instance;
}

/** A pass of a field loop a body is lowered in (§4): the loop's header, and the field it visits. */
export interface FieldPassStep {
  readonly header: FieldHeader;
  readonly field: string;
}

/** The declaration `owner` is: its function's, or the constant's. */
export function ownerDeclaration(
  owner: BodyOwner,
): FunctionDeclaration | VariableDeclaration | ContextConstantDeclaration {
  return owner.kind === 'constant' || owner.kind === 'contextConstant'
    ? owner.declaration
    : owner.instance.declaration;
}

/**
 * The instance of `declaration` that nothing calls in code of a kind, with its `written` type
 * arguments: a start, which a host runs (§9), or a conversion's own function. A mark parameter
 * left unwritten (`M in Mark`) is `"simple"`: a conversion's converter is simple code.
 */
export function rootInstance(
  lookup: QualifierLookup,
  declaration: FunctionDeclaration,
  written: readonly Type[] = [],
): FunctionInstance {
  const rest = typeParametersOf(declaration.typeParameters)
    .slice(written.length)
    .filter((parameter) => isMarkParameter(lookup, parameter))
    .map(() => simpleMark);
  return { declaration, typeArguments: [...written, ...rest], witnesses: new Map() };
}

/**
 * A plain function value made async at `site`, in the body `owner` lowers, where an async function
 * is expected (§3.14): its entry calls the value of the plain function type `type`, giving what it
 * gives as a future of `made`, the type it is made into, whose future's kind the entry runs in.
 */
export interface AsyncFit {
  readonly owner: BodyOwner;
  readonly site: NodeOf<string>;
  readonly type: FunctionType;
  readonly made: FunctionType;
}

/**
 * A conversion of parts lowering writes an entry for (§3.5), one per pair of types, wherever the
 * pair is met: a value of `from` made to fit `to` as the checker fits them (`converting`), or a
 * function of type `from` wrapped as one of `to`, converting what it takes and gives (`wrapping`).
 * Where the pair was first met (`at`) names and places it, so a trace through it points there.
 */
export type ConversionEntry =
  | {
      readonly kind: 'converting';
      readonly from: Type;
      readonly to: Type;
      readonly at: ConversionSite;
    }
  | {
      readonly kind: 'wrapping';
      readonly from: FunctionType;
      readonly to: FunctionType;
      readonly at: ConversionSite;
    };

/** Where a conversion stands: its module, and the span its code points at. */
export interface ConversionSite {
  readonly module: ModuleId;
  readonly span: AnchoredSpan;
}

/** The key of a conversion's entry: its kind, then both types'. */
export function conversionKey(keys: TypeKeys, entry: ConversionEntry): string {
  return `${entry.kind}:${keys.typeKey(entry.from)}->${keys.typeKey(entry.to)}`;
}

/** A conversion's name: both types' table keys. */
export function conversionName(checker: Checker, entry: ConversionEntry): string {
  return `${tableKey(checker, entry.from)} as ${tableKey(checker, entry.to)}`;
}

/** The key of a nested function's entry: its owner's, then its node's identity. */
export function nestedKey(keys: TypeKeys, nested: NestedInstance): string {
  return `${ownerKey(keys, nested.owner)}#${keys.identityOf(nested.node)}`;
}

/** The key of an async fit's entry: its owner's, then its site's identity. */
export function asyncFitKey(keys: TypeKeys, fit: AsyncFit): string {
  return `${ownerKey(keys, fit.owner)}#async${keys.identityOf(fit.site)}`;
}

function ownerKey(keys: TypeKeys, owner: BodyOwner): string {
  const own =
    owner.kind === 'constant' || owner.kind === 'contextConstant'
      ? `${owner.kind} ${keys.identityOf(owner.declaration)}`
      : `${instanceKey(keys, owner.instance)}${owner.kind === 'defaults' ? '=' : ''}`;
  const passes = (owner.passes ?? []).map(
    ({ header, field }) => `[${keys.identityOf(header)}.${field}]`,
  );
  return `${own}${passes.join('')}`;
}

/** A nested function's name: its owner's, then its own name, or where a lambda stands. */
export function nestedName(checker: Checker, nested: NestedInstance, where: string): string {
  const { node } = nested;
  const own = node.name === undefined ? `lambda@${where}` : node.name.text;
  return `${ownerName(checker, nested.owner)}.${own}`;
}

/** An async fit's name: its owner's, then where its site stands. */
export function asyncFitName(checker: Checker, fit: AsyncFit, where: string): string {
  return `${ownerName(checker, fit.owner)}.async@${where}`;
}

function ownerName(checker: Checker, owner: BodyOwner): string {
  const own =
    owner.kind === 'constant' || owner.kind === 'contextConstant'
      ? qualifiedNameOf(checker, owner.declaration)
      : instanceName(checker, owner.instance);
  const passes = (owner.passes ?? []).map(({ field }) => `[${field}]`);
  return `${own}${passes.join('')}`;
}

/** The key two instances share exactly when they are one entry. */
export function instanceKey(keys: TypeKeys, instance: FunctionInstance): string {
  const typeArguments = instance.typeArguments.map((type) => keys.typeKey(type));
  return `${keys.identityOf(instance.declaration)}<${typeArguments.join(',')}>`;
}

/**
 * An instance's name in the Definition (definition.md, "Names"): the declaration's, with its type
 * arguments' table keys.
 */
export function instanceName(checker: Checker, instance: FunctionInstance): string {
  const { declaration, typeArguments } = instance;
  const generic =
    typeArguments.length === 0
      ? ''
      : `<${typeArguments.map((type) => tableKey(checker, type)).join(', ')}>`;
  return `${qualifiedNameOf(checker, declaration)}${generic}`;
}
