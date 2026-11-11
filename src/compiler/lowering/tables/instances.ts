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
 *   value is one entry, owned by the constant, which has no type parameters to substitute. The
 *   function a deferred call gives (§3.14) is keyed alike, by the call it makes later, and carries
 *   that call as its owner's instance closed it, since it has no body of its own to read.
 */

import type { Checker } from '../../checker/check.ts';
import type { ValueSite } from '../../checker/surface/checked-body.ts';
import type { Witnesses } from '../../checker/surface/resolved-call.ts';
import type { TypeKeys } from '../../checker/types/identity/type-keys.ts';
import { type Substitution, substitutionFor } from '../../checker/types/parts/substitution.ts';
import {
  isMarkParameter,
  type QualifierLookup,
  simpleMark,
} from '../../checker/types/type/function-kinds.ts';
import type { FunctionType, Type } from '../../checker/types/type/index.ts';
import { literalType } from '../../checker/types/type/primitives.ts';
import type { ModuleId } from '../../program/program.ts';
import { type FunctionDeclaration, typeParametersOf } from '../../syntax/declarations/index.ts';
import type { Expression, FieldHeader, Lambda } from '../../syntax/expressions/index.ts';
import type { VariableDeclaration } from '../../syntax/statements/index.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { CallTarget } from '../calls/emit-call.ts';
import { qualifiedNameOf, spelledType } from './names.ts';

/** One function-table entry's function: a closed call, with every type concrete. */
export interface FunctionInstance {
  readonly declaration: FunctionDeclaration;
  readonly typeArguments: readonly Type[];
  readonly witnesses: Witnesses;
}

/** A lambda or local function inside one instance of the top-level function holding it. */
export interface NestedInstance {
  readonly owner: BodyOwner;
  readonly node: Lambda | FunctionDeclaration;
}

/**
 * What a lowered body belongs to: an instance of a function, the defaults of one, which its
 * prologue computes (§3.3), or a top-level constant's value; and the passes of the field loops it
 * is lowered inside (§4), outermost first, each read as checked.
 */
export type BodyOwner = (
  | { readonly kind: 'function'; readonly instance: FunctionInstance }
  | { readonly kind: 'defaults'; readonly instance: FunctionInstance }
  | { readonly kind: 'constant'; readonly declaration: VariableDeclaration }
) & { readonly passes?: readonly FieldPassStep[] };

/** The function instance `owner` belongs to: its body's or its defaults'; none for a constant. */
export function ownerInstance(owner: BodyOwner): FunctionInstance | undefined {
  return owner.kind === 'constant' ? undefined : owner.instance;
}

/** A pass of a field loop a body is lowered in (§4): the loop's header, and the field it visits. */
export interface FieldPassStep {
  readonly header: FieldHeader;
  readonly field: string;
}

/**
 * What the keys of the field loops `passes` are lowered in stand for: each field's name, as its
 * literal type, which the pass of the fields a struct constraint leaves unnamed needs (§4).
 */
export function passBindings(passes: readonly FieldPassStep[] = []): Substitution {
  return new Map(passes.map(({ header, field }) => [header, literalType(field)] as const));
}

/** The declaration `owner` is: its function's, or the constant's. */
export function ownerDeclaration(owner: BodyOwner): FunctionDeclaration | VariableDeclaration {
  return owner.kind === 'constant' ? owner.declaration : owner.instance.declaration;
}

/**
 * How `owner` maps type parameters: its instance's arguments, a constant none; and the keys of
 * the field loops it is lowered inside (`passBindings`).
 */
export function ownerSubstitution(owner: BodyOwner): Substitution {
  const instance = ownerInstance(owner);
  const own = instance === undefined ? new Map() : substitutionOf(instance);
  return new Map([...own, ...passBindings(owner.passes)]);
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

/** How the instance maps its declaration's type parameters. */
export function substitutionOf(
  instance: Pick<FunctionInstance, 'declaration' | 'typeArguments'>,
): Substitution {
  return substitutionFor(
    typeParametersOf(instance.declaration.typeParameters),
    instance.typeArguments,
  );
}

/**
 * A plain function value made async at `site`, in the body `owner` lowers, where an async function
 * is expected (§3.14): its entry calls the value of the plain function type `type`, giving what it
 * gives as a future of `made`, the type it is made into, whose future's kind the entry runs in.
 */
export interface AsyncFit {
  readonly owner: BodyOwner;
  readonly site: ValueSite;
  readonly type: FunctionType;
  readonly made: FunctionType;
}

/**
 * The function a deferred call gives its taker (§3.14), in the body `owner` lowers: an entry
 * making the call `plan` closes from what it captures.
 */
export interface DeferredFunction {
  readonly owner: BodyOwner;
  readonly plan: DeferredPlan;
}

/**
 * How the function a deferred call gives makes its call from what it captures, in order: a
 * function value's callee first, then each value the call passes, then, for a deferred call, what
 * the function it gives in turn captures.
 */
export interface DeferredPlan {
  /** The call made later, as written: where its entry stands. */
  readonly site: Expression;
  /**
   * What the call calls: the function the checker resolved, as any call targets it, or a function
   * value the function captured first, which has no register until its entry runs (§3.14).
   */
  readonly target:
    | Extract<CallTarget, { readonly kind: 'function' }>
    | { readonly kind: 'captured' };
  /**
   * How many values the call passes as written: a method's receiver and its arguments, a function
   * value's in its parameters' order, a pack's spread as its elements.
   */
  readonly passes: number;
  /**
   * For a deferred call, the function it gives its taker and where among those values it goes:
   * past them for a resolved function, at the parameter it fills for a function value.
   */
  readonly gives: { readonly plan: DeferredPlan; readonly at: number } | undefined;
  /** What the call gives. */
  readonly result: Type;
  /** The type the function is given as: the parameter of the taker it fills. */
  readonly givenAs: FunctionType;
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

/** A conversion's name: both types, as written. */
export function conversionName(checker: Checker, entry: ConversionEntry): string {
  return `${spelledType(checker, entry.from)} as ${spelledType(checker, entry.to)}`;
}

/** The key of a nested function's entry: its owner's, then its node's identity. */
export function nestedKey(keys: TypeKeys, nested: NestedInstance): string {
  return `${ownerKey(keys, nested.owner)}#${keys.identityOf(nested.node)}`;
}

/** The key of a deferred call's function's entry: its owner's, then the call's identity. */
export function deferredKey(keys: TypeKeys, deferred: DeferredFunction): string {
  return `${ownerKey(keys, deferred.owner)}#deferred${keys.identityOf(deferred.plan.site)}`;
}

/** The key of an async fit's entry: its owner's, then its site's identity. */
export function asyncFitKey(keys: TypeKeys, fit: AsyncFit): string {
  return `${ownerKey(keys, fit.owner)}#async${keys.identityOf(fit.site)}`;
}

function ownerKey(keys: TypeKeys, owner: BodyOwner): string {
  const own =
    owner.kind === 'constant'
      ? `const ${keys.identityOf(owner.declaration)}`
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

/** A deferred call's function's name: its owner's, then where the call stands. */
export function deferredName(checker: Checker, deferred: DeferredFunction, where: string): string {
  return `${ownerName(checker, deferred.owner)}.deferred@${where}`;
}

/** An async fit's name: its owner's, then where its site stands. */
export function asyncFitName(checker: Checker, fit: AsyncFit, where: string): string {
  return `${ownerName(checker, fit.owner)}.async@${where}`;
}

function ownerName(checker: Checker, owner: BodyOwner): string {
  const own =
    owner.kind === 'constant'
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
 * arguments spelled as keys spell them.
 */
export function instanceName(checker: Checker, instance: FunctionInstance): string {
  const { declaration, typeArguments } = instance;
  // The kind an unmarked function is instantiated at is no argument written (§3.3): its entries'
  // modes tell them apart, and its key keeps it.
  const written = typeArguments.slice(0, typeParametersOf(declaration.typeParameters).length);
  const generic =
    written.length === 0 ? '' : `<${written.map((type) => spelledType(checker, type)).join(', ')}>`;
  return `${qualifiedNameOf(checker, declaration)}${generic}`;
}
