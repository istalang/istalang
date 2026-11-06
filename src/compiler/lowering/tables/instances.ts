/**
 * Instances (§3.5: generics are compiled per instantiation): what one function-table entry is.
 *
 * - An instance is a declaration with concrete type arguments, the concrete witnesses of its
 *   constraints (§3.10), and which of its entries it is (`InstanceEntry`): its own code, the code
 *   giving one parameter its default (§3.1, §3.3), or code filling a call's left-out parameters.
 * - A body is checked once, generically (checker), so lowering one instance reads the body
 *   through its substitution (checker/body/facts/instantiation.ts), and closes every call it makes
 *   (../calls/closed-calls.ts).
 * - Two instances are one entry when their key is: the declaration, its arguments' types, and which
 *   entry. Witnesses are coherent (§3.10), the same for the same types wherever they are found, so
 *   the types decide them.
 * - A lambda or local function (§3.14) is an entry of its own per instance of the top-level
 *   function holding it: it is checked within that body, so it reads the body through the same
 *   substitution, and its key is the instance's plus its node. A lambda in a top-level constant's
 *   value is one entry, owned by the constant, which has no type parameters to substitute.
 */

import type { Checker } from '../../checker/check.ts';
import type { ValueSite } from '../../checker/surface/checked-body.ts';
import type { Binding, Witnesses } from '../../checker/surface/resolved-call.ts';
import type { TypeKeys } from '../../checker/types/identity/type-keys.ts';
import { type Substitution, substitutionFor } from '../../checker/types/substitution.ts';
import type { FunctionType, Type } from '../../checker/types/type/index.ts';
import { literalType } from '../../checker/types/unions/unions.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { FieldHeader, Lambda } from '../../syntax/expressions/index.ts';
import type { VariableDeclaration } from '../../syntax/statements.ts';
import { qualifiedNameOf, spelledType } from './names.ts';

/** One function-table entry's function: a closed call, with every type concrete. */
export interface FunctionInstance {
  readonly declaration: FunctionDeclaration;
  readonly typeArguments: readonly Type[];
  readonly witnesses: Witnesses;
  readonly entry: InstanceEntry;
}

/**
 * Which entry of its function an instance is: its own code, or extern, taking every parameter; the
 * code giving parameter `parameter` its default from the parameters before it (§3.1, §3.3); or
 * code taking a call's arguments as passed, filling the parameters as `binding` says, then running
 * the function's own entry.
 */
type InstanceEntry =
  | { readonly kind: 'own' }
  | { readonly kind: 'default'; readonly parameter: number }
  | { readonly kind: 'filling'; readonly binding: Binding };

export const ownEntry: InstanceEntry = { kind: 'own' };

/** A lambda or local function inside one instance of the top-level function holding it. */
export interface NestedInstance {
  readonly owner: BodyOwner;
  readonly node: Lambda | FunctionDeclaration;
}

/**
 * What a lowered body belongs to: an instance of a function, or a top-level constant's value; and
 * the passes of the field loops it is lowered inside (§4), outermost first, each read as checked.
 */
export type BodyOwner = (
  | { readonly kind: 'function'; readonly instance: FunctionInstance }
  | { readonly kind: 'constant'; readonly declaration: VariableDeclaration }
) & { readonly passes?: readonly FieldPassStep[] };

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
  return owner.kind === 'function' ? owner.instance.declaration : owner.declaration;
}

/**
 * How `owner` maps type parameters: its instance's arguments, a constant none; and the keys of
 * the field loops it is lowered inside (`passBindings`).
 */
export function ownerSubstitution(owner: BodyOwner): Substitution {
  const own = owner.kind === 'function' ? substitutionOf(owner.instance) : new Map();
  return new Map([...own, ...passBindings(owner.passes)]);
}

/** The instance `main` is: no type arguments, its own entry. */
export function rootInstance(declaration: FunctionDeclaration): FunctionInstance {
  return { declaration, typeArguments: [], witnesses: new Map(), entry: ownEntry };
}

/** How the instance maps its declaration's type parameters. */
export function substitutionOf(
  instance: Pick<FunctionInstance, 'declaration' | 'typeArguments'>,
): Substitution {
  return substitutionFor(instance.declaration.typeParameters, instance.typeArguments);
}

/**
 * A plain function value made async at `site`, in the body `owner` lowers, where an async function
 * is expected (§3.14): its entry calls the value of the plain function type `type`.
 */
export interface AsyncFit {
  readonly owner: BodyOwner;
  readonly site: ValueSite;
  readonly type: FunctionType;
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
    owner.kind === 'function'
      ? instanceKey(keys, owner.instance)
      : `const ${keys.identityOf(owner.declaration)}`;
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
    owner.kind === 'function'
      ? instanceName(checker, owner.instance)
      : qualifiedNameOf(checker, owner.declaration);
  const passes = (owner.passes ?? []).map(({ field }) => `[${field}]`);
  return `${own}${passes.join('')}`;
}

/** The key two instances share exactly when they are one entry. */
export function instanceKey(keys: TypeKeys, instance: FunctionInstance): string {
  const typeArguments = instance.typeArguments.map((type) => keys.typeKey(type));
  return `${keys.identityOf(instance.declaration)}<${typeArguments.join(',')}>${entryKey(instance.entry)}`;
}

function entryKey(entry: InstanceEntry): string {
  switch (entry.kind) {
    case 'own':
      return '';
    case 'default':
      return `=${entry.parameter}`;
    case 'filling':
      return `(${entry.binding.map(sourceKey).join(',')})`;
    default: {
      const unhandled: never = entry;
      return unhandled;
    }
  }
}

/** A parameter's source as a filling entry's key spells it, so two different fillings never share one. */
function sourceKey(source: Binding[number]): string {
  switch (source.kind) {
    case 'argument':
      return String(source.index);
    case 'rest':
      return `r${source.items.map(({ index, isSpread }) => `${isSpread ? '*' : ''}${index}`).join('.')}`;
    case 'default':
      return 'd';
    default: {
      const unhandled: never = source;
      return unhandled;
    }
  }
}

/**
 * An instance's name in the Definition (definition.md, "Names"): the declaration's, with its type
 * arguments spelled as keys spell them, and for a default's entry, `/` and the parameter's name, or
 * its position for a pattern with no name.
 */
export function instanceName(checker: Checker, instance: FunctionInstance): string {
  const { declaration, typeArguments, entry } = instance;
  const name = qualifiedNameOf(checker, declaration);
  const generic =
    typeArguments.length === 0
      ? ''
      : `<${typeArguments.map((type) => spelledType(checker, type)).join(', ')}>`;
  if (entry.kind !== 'default') {
    return `${name}${generic}`;
  }
  const parameter = checker.parametersOf(declaration)[entry.parameter];
  return `${name}${generic}/${parameter?.node.name?.text ?? entry.parameter}`;
}
