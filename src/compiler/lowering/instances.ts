/**
 * Instances (§3.5: generics are compiled per instantiation): what one function-table entry is.
 *
 * - An instance is a declaration with concrete type arguments, the concrete witnesses of its
 *   constraints (§3.10), and how many arguments its callers give: a call leaving parameters to
 *   their defaults targets a generated entry of its own (§3.3).
 * - A body is checked once, generically (checker), so lowering one instance reads the body
 *   through its substitution (checker/types/instantiation.ts), and closes every call it makes:
 *   type arguments naming the instance's own parameters are substituted, and a call to a
 *   requirement becomes the witness the instance was given for it.
 * - Two instances are one entry when their key is: the declaration, its arguments' types, and its
 *   arity. Witnesses are coherent (§3.10), the same for the same types wherever they are found, so
 *   the types decide them.
 * - A lambda or local function (§3.14) is an entry of its own per instance of the top-level
 *   function holding it: it is checked within that body, so it reads the body through the same
 *   substitution, and its key is the instance's plus its node. A lambda in a top-level constant's
 *   value is one entry, owned by the constant, which has no type parameters to substitute.
 */

import { unreachable } from '../../structures/unreachable.ts';
import type { Checker } from '../checker/check.ts';
import type { FunctionCall, ResolvedCall, Witnesses } from '../checker/resolved-call.ts';
import {
  type AnyType,
  type ParameterKey,
  type Substitution,
  substitute,
  substituteAny,
  substitutionFor,
  type Type,
} from '../checker/types/type.ts';
import type { TypeKeys } from '../checker/types/type-keys.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import type { Lambda } from '../syntax/expressions/index.ts';
import type { VariableDeclaration } from '../syntax/statements.ts';
import { qualifiedNameOf, spelledType } from './names.ts';

/** One function-table entry's function: a closed call, with every type concrete. */
export interface FunctionInstance {
  readonly declaration: FunctionDeclaration;
  readonly typeArguments: readonly Type[];
  readonly witnesses: Witnesses;
  readonly arity: number;
}

/** A lambda or local function inside one instance of the top-level function holding it. */
export interface NestedInstance {
  readonly owner: BodyOwner;
  readonly node: Lambda | FunctionDeclaration;
}

/** What a lowered body belongs to: an instance of a function, or a top-level constant's value. */
export type BodyOwner =
  | { readonly kind: 'function'; readonly instance: FunctionInstance }
  | { readonly kind: 'constant'; readonly declaration: VariableDeclaration };

/** The declaration `owner` is: its function's, or the constant's. */
export function ownerDeclaration(owner: BodyOwner): FunctionDeclaration | VariableDeclaration {
  return owner.kind === 'function' ? owner.instance.declaration : owner.declaration;
}

/** How `owner` maps type parameters: its instance's arguments; a constant has none. */
export function ownerSubstitution(owner: BodyOwner): Substitution {
  return owner.kind === 'function' ? substitutionOf(owner.instance) : new Map();
}

/** The instance `main` is: no type arguments, every argument given. */
export function rootInstance(checker: Checker, declaration: FunctionDeclaration): FunctionInstance {
  return {
    declaration,
    typeArguments: [],
    witnesses: new Map(),
    arity: checker.parametersOf(declaration).length,
  };
}

/** How the instance maps its declaration's type parameters. */
export function substitutionOf(instance: FunctionInstance): Substitution {
  return substitutionFor(instance.declaration.typeParameters, instance.typeArguments);
}

/** A call resolved inside the body of `within`, closed there. */
export function calleeOf(resolved: ResolvedCall, within: BodyOwner): ClosedCall {
  return closeCall(resolved, within.kind === 'function' ? within.instance : undefined);
}

/** The instance a closed call targets: its function, every type concrete. */
export function instanceOfCall(call: FunctionCall): FunctionInstance {
  return {
    declaration: call.function,
    typeArguments: call.typeArguments,
    witnesses: call.witnesses,
    arity: call.arity,
  };
}

/** The instance of the same function taking every argument: what a defaults entry calls. */
export function fullInstance(checker: Checker, instance: FunctionInstance): FunctionInstance {
  return { ...instance, arity: checker.parametersOf(instance.declaration).length };
}

/** The key of a nested function's entry: its owner's, then its node's identity. */
export function nestedKey(keys: TypeKeys, nested: NestedInstance): string {
  const { owner, node } = nested;
  const ownerKey =
    owner.kind === 'function'
      ? instanceKey(keys, owner.instance)
      : `const ${keys.identityOf(owner.declaration)}`;
  return `${ownerKey}#${keys.identityOf(node)}`;
}

/** A nested function's name: its owner's, then its own name, or where a lambda stands. */
export function nestedName(checker: Checker, nested: NestedInstance, where: string): string {
  const { owner, node } = nested;
  const own = node.name === undefined ? `lambda@${where}` : node.name.text;
  const outer =
    owner.kind === 'function'
      ? instanceName(checker, owner.instance)
      : qualifiedNameOf(checker, owner.declaration);
  return `${outer}.${own}`;
}

/** The key two instances share exactly when they are one entry. */
export function instanceKey(keys: TypeKeys, instance: FunctionInstance): string {
  const typeArguments = instance.typeArguments.map((type) => keys.typeKey(type));
  return `${keys.identityOf(instance.declaration)}<${typeArguments.join(',')}>/${instance.arity}`;
}

/**
 * An instance's name in the Definition (definition.md, "Names"): the declaration's, with its type
 * arguments spelled as keys spell them, and a defaults entry's arity after a `/`.
 */
export function instanceName(checker: Checker, instance: FunctionInstance): string {
  const { declaration, typeArguments, arity } = instance;
  const name = qualifiedNameOf(checker, declaration);
  const generic =
    typeArguments.length === 0
      ? ''
      : `<${typeArguments.map((type) => spelledType(checker, type)).join(', ')}>`;
  const defaults = arity < checker.parametersOf(declaration).length ? `/${arity}` : '';
  return `${name}${generic}${defaults}`;
}

/**
 * A call closed inside an instance, every type in it concrete: a function's, or one dispatched on
 * the own type of the `any` value it is called with (§3.10), a requirement on an `any` type.
 */
export type ClosedCall = ResolvedCall;

/**
 * A call dispatched on an `any` value's own type: the `member`-th function of the trait of the
 * `constraint`-th constraint of `on`, with its own type arguments, every type concrete.
 */
export interface Dispatch {
  readonly on: AnyType;
  readonly constraint: number;
  readonly member: number;
  readonly required: FunctionDeclaration;
  readonly typeArguments: readonly Type[];
}

/** The dispatch a closed call that isn't a function's makes. */
export function dispatchOf(call: Exclude<ClosedCall, FunctionCall>): Dispatch {
  const { on, constraint, member } = call.requirement;
  if (on.kind !== 'any') {
    unreachable(`A call on '${on.name.text}' was left open by closing.`);
  }
  return { on, constraint, member, required: call.function, typeArguments: call.typeArguments };
}

/**
 * `resolved`, closed inside `within`: type arguments substituted, requirements on type parameters
 * their witnesses. A constant's value is within no instance, so nothing in it names a type
 * parameter.
 */
export function closeCall(
  resolved: ResolvedCall,
  within: FunctionInstance | undefined,
): ClosedCall {
  const substitution =
    within === undefined ? new Map<ParameterKey, Type>() : substitutionOf(within);
  const typeArguments = resolved.typeArguments.map((type) => substitute(type, substitution));
  if (resolved.kind === 'function') {
    return { ...resolved, typeArguments, witnesses: closeWitnesses(resolved.witnesses, within) };
  }
  const { on, constraint, member } = resolved.requirement;
  if (on.kind === 'any') {
    const closed = { on: substituteAny(on, substitution), constraint, member };
    return { ...resolved, requirement: closed, typeArguments };
  }
  const witness = within?.witnesses.get(on)?.[constraint]?.[member];
  if (witness === undefined) {
    unreachable(`No witness for '${on.name.text}'; checking should have found one.`);
  }
  const own = new Map<ParameterKey, Type>([
    ...substitution,
    ...substitutionFor(resolved.function.typeParameters, typeArguments),
  ]);
  return {
    ...witness,
    typeArguments: witness.typeArguments.map((type) => substitute(type, own)),
  };
}

function closeWitnesses(witnesses: Witnesses, within: FunctionInstance | undefined): Witnesses {
  return new Map(
    [...witnesses].map(([parameter, constraints]) => [
      parameter,
      constraints.map((calls) => calls.map((call) => closeCall(call, within))),
    ]),
  );
}
