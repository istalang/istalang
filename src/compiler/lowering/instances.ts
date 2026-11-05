/**
 * Instances (§3.5: generics are compiled per instantiation): what one function-table entry is.
 *
 * - An instance is a declaration with concrete type arguments, the concrete witnesses of its
 *   constraints (§3.10), and which of its entries it is (`InstanceEntry`): its own code, the code
 *   giving one parameter its default (§3.1, §3.3), or code filling a call's left-out parameters.
 * - A body is checked once, generically (checker), so lowering one instance reads the body
 *   through its substitution (checker/types/instantiation.ts), and closes every call it makes:
 *   type arguments naming the instance's own parameters are substituted, and a call to a
 *   requirement becomes the witness the instance was given for it.
 * - Two instances are one entry when their key is: the declaration, its arguments' types, and which
 *   entry. Witnesses are coherent (§3.10), the same for the same types wherever they are found, so
 *   the types decide them.
 * - A call written in code fills the parameters it leaves out itself, through their defaults'
 *   entries (emit-call.ts), and runs the function's own entry. An entry handed out to be called
 *   later, a function named as a shorter value (§3.14), a spawned call (§9) or one the runtime
 *   makes, takes the arguments as passed (`takingPassed`): a filling entry when the call leaves
 *   parameters out or passes them out of order, whose code does the same.
 * - A lambda or local function (§3.14) is an entry of its own per instance of the top-level
 *   function holding it: it is checked within that body, so it reads the body through the same
 *   substitution, and its key is the instance's plus its node. A lambda in a top-level constant's
 *   value is one entry, owned by the constant, which has no type parameters to substitute.
 */

import { unreachable } from '../../structures/unreachable.ts';
import type { Checker, SignatureParameter, ValueSite } from '../checker/check.ts';
import {
  type Binding,
  type FunctionCall,
  passesAll,
  type ResolvedCall,
  type Witnesses,
} from '../checker/resolved-call.ts';
import {
  type Substitution,
  substitute,
  substituteAny,
  substitutionFor,
} from '../checker/types/substitution.ts';
import {
  type AnyType,
  type FunctionType,
  isOpaque,
  type ParameterKey,
  type Type,
} from '../checker/types/type.ts';
import type { TypeKeys } from '../checker/types/type-keys.ts';
import { typeText } from '../checker/types/type-text.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import type { Lambda } from '../syntax/expressions/index.ts';
import type { VariableDeclaration } from '../syntax/statements.ts';
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

const ownEntry: InstanceEntry = { kind: 'own' };

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

/** `resolved`, a call made inside the body `within` owns, closed there as `program` says. */
export function closeCallWithin(
  resolved: ResolvedCall,
  within: BodyOwner,
  program: Closer,
): ClosedCall {
  return closeCall(resolved, within.kind === 'function' ? within.instance : undefined, program);
}

/**
 * The instance taking a closed call's arguments as it passes them, for a caller that only gets
 * an entry to call later: the function's own, or a filling one when the call leaves parameters to
 * their defaults or passes them out of order.
 */
export function takingPassed(call: ClosedFunctionCall): FunctionInstance {
  const { instance, binding } = call;
  return passesAll(binding) ? instance : { ...instance, entry: { kind: 'filling', binding } };
}

/** The entry of a closed call's function giving parameter `parameter` its default. */
export function defaultEntryOf(call: ClosedFunctionCall, parameter: number): FunctionInstance {
  return { ...call.instance, entry: { kind: 'default', parameter } };
}

/** The call a filling entry makes: its function's own entry, filled as `binding` says. */
export function callOfFilling(instance: FunctionInstance, binding: Binding): ClosedFunctionCall {
  return { kind: 'function', instance: { ...instance, entry: ownEntry }, binding };
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
  return owner.kind === 'function'
    ? instanceKey(keys, owner.instance)
    : `const ${keys.identityOf(owner.declaration)}`;
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
  return owner.kind === 'function'
    ? instanceName(checker, owner.instance)
    : qualifiedNameOf(checker, owner.declaration);
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
 * arguments spelled as keys spell them, and for a default's entry, `/` and the parameter's name.
 */
export function instanceName(checker: Checker, instance: FunctionInstance): string {
  const { declaration, typeArguments, entry } = instance;
  const name = qualifiedNameOf(checker, declaration);
  const generic =
    typeArguments.length === 0
      ? ''
      : `<${typeArguments.map((type) => spelledType(checker, type)).join(', ')}>`;
  const parameter =
    entry.kind === 'default' ? checker.parametersOf(declaration)[entry.parameter] : undefined;
  return `${name}${generic}${parameter === undefined ? '' : `/${parameter.node.name.text}`}`;
}

/**
 * What a call closed inside an instance targets, every type in it concrete: a function's own
 * entry, with which argument each of its parameters takes (§3.3), or a dispatch on the own type of
 * the `any` value it is called with, which passes every argument by position (§3.10).
 */
export type ClosedCall =
  | ClosedFunctionCall
  | { readonly kind: 'dispatch'; readonly dispatch: Dispatch; readonly binding: Binding };

/** The parameters of the function `called` runs, or of the required one a dispatch runs. */
export function calledParameters(
  checker: Pick<Checker, 'parametersOf'>,
  called: ClosedCall,
): readonly SignatureParameter[] {
  const declaration =
    called.kind === 'dispatch' ? called.dispatch.required : called.instance.declaration;
  return checker.parametersOf(declaration);
}

/** How `call`'s function maps its type parameters: its instance's, or its dispatch's. */
export function substitutionOfCall(call: ClosedCall): Substitution {
  if (call.kind === 'function') {
    return substitutionOf(call.instance);
  }
  const { required, typeArguments } = call.dispatch;
  return substitutionFor(required.typeParameters, typeArguments);
}

/** A closed call of a function: its own entry's instance, and the call's binding. */
export interface ClosedFunctionCall {
  readonly kind: 'function';
  readonly instance: FunctionInstance;
  readonly binding: Binding;
}

/**
 * A call dispatched on a value's own type: the `member`-th function of the trait of the
 * `constraint`-th constraint of the `any` type `through`, with its own type arguments and the
 * witnesses of their constraints, every type concrete. The value is of `on`: `through` itself for
 * an `any` value; for a call through a union's trait (§6), the union, or the one type an
 * instantiation collapsed it into, each member called as a value of `through` would be.
 */
export interface Dispatch {
  readonly on: Type;
  readonly through: AnyType;
  readonly constraint: number;
  readonly member: number;
  readonly required: FunctionDeclaration;
  readonly typeArguments: readonly Type[];
  readonly witnesses: Witnesses;
}

/**
 * What closing a call asks of the program: the rules its types are built by, and the witnesses a
 * type an instantiation made known meets a trait with, for a requirement on a computed type.
 */
export type Closer = Pick<Checker, 'typeRules' | 'memberWitnesses'>;

/** What closing reads of the instance a call is closed inside: how it maps type parameters. */
type Closing = Pick<FunctionInstance, 'declaration' | 'typeArguments' | 'witnesses'>;

/**
 * What `resolved` targets, closed inside `within`, as `program` says (`Closer`). A
 * constant's value is within no instance, so nothing in it names a type parameter.
 */
export function closeCall(
  resolved: ResolvedCall,
  within: Closing | undefined,
  program: Closer,
): ClosedCall {
  const closed = closedInside(resolved, within, program);
  if (closed.kind === 'function') {
    return { kind: 'function', instance: instanceOf(closed), binding: closed.binding };
  }
  const { function: required, typeArguments, witnesses, binding } = closed;
  const called = { required, typeArguments, witnesses };
  const origin = closed.requirement;
  if (origin.kind === 'members') {
    const { on, through, member } = origin;
    return {
      kind: 'dispatch',
      dispatch: { on, through, constraint: 0, member, ...called },
      binding,
    };
  }
  if (origin.kind === 'computed') {
    return unreachable(`No witness for ${typeText(origin.on)}; checking should have found one.`);
  }
  const { on, constraint, member } = origin;
  if (on.kind !== 'any') {
    unreachable(`No witness for '${on.name.text}'; checking should have found one.`);
  }
  return {
    kind: 'dispatch',
    dispatch: { on, through: on, constraint, member, ...called },
    binding,
  };
}

/** The instance a call to a function targets, closed inside `within`. */
export function closeFunctionCall(
  call: FunctionCall,
  within: Closing | undefined,
  program: Closer,
): FunctionInstance {
  const substitution =
    within === undefined ? new Map<ParameterKey, Type>() : substitutionOf(within);
  return instanceOf({
    ...call,
    typeArguments: call.typeArguments.map((type) =>
      substitute(type, substitution, program.typeRules),
    ),
    witnesses: closeWitnesses(call.witnesses, within, program),
  });
}

function instanceOf({ function: declaration, typeArguments, witnesses }: FunctionCall) {
  return { declaration, typeArguments, witnesses, entry: ownEntry };
}

/**
 * The call a function meeting the requirement `dispatch` names makes when called through it,
 * closed inside the requirement's own instance, whose type arguments and witnesses `dispatch` has.
 */
export function closeWitness(
  witness: ResolvedCall,
  dispatch: Dispatch,
  program: Closer,
): ClosedCall {
  const { required: declaration, typeArguments, witnesses } = dispatch;
  return closeCall(witness, { declaration, typeArguments, witnesses }, program);
}

/**
 * `resolved` inside `within`: type arguments substituted, and a requirement on one of the
 * instance's type parameters the witness the instance was given for it, closed inside the
 * requirement's own instance. A requirement on another function's type parameters, such as one a
 * generic required function's own constraints make, stays open until that function's call closes
 * it, so an instance's witnesses may hold one.
 */
function closedInside(
  resolved: ResolvedCall,
  within: Closing | undefined,
  program: Closer,
): ResolvedCall {
  const substitution =
    within === undefined ? new Map<ParameterKey, Type>() : substitutionOf(within);
  if (resolved.kind === 'function') {
    const { typeArguments, witnesses } = closeFunctionCall(resolved, within, program);
    return { ...resolved, typeArguments, witnesses };
  }
  const typeArguments = resolved.typeArguments.map((type) =>
    substitute(type, substitution, program.typeRules),
  );
  const witnesses = closeWitnesses(resolved.witnesses, within, program);
  const origin = resolved.requirement;
  if (origin.kind === 'computed') {
    const on = substitute(origin.on, substitution, program.typeRules);
    const through = substituteAny(origin.through, substitution, program.typeRules);
    if (isOpaque(on)) {
      return { ...resolved, requirement: { ...origin, on, through }, typeArguments, witnesses };
    }
    const witness =
      program.memberWitnesses(through, 0, on)[origin.member] ??
      unreachable(`${typeText(on)} meets its bound without '${resolved.function.name.text}'.`);
    const inRequired = { declaration: resolved.function, typeArguments, witnesses };
    const met = closedInside(witness, inRequired, program);
    return { ...met, binding: composed(met.binding, resolved.binding) };
  }
  if (origin.kind === 'members') {
    const through = substituteAny(origin.through, substitution, program.typeRules);
    const closed = {
      ...origin,
      on: substitute(origin.on, substitution, program.typeRules),
      through,
    };
    return { ...resolved, requirement: closed, typeArguments, witnesses };
  }
  const { on, constraint, member } = origin;
  if (on.kind === 'any') {
    const closed = { ...origin, on: substituteAny(on, substitution, program.typeRules) };
    return { ...resolved, requirement: closed, typeArguments, witnesses };
  }
  const witness = within?.witnesses.get(on)?.[constraint]?.[member];
  if (witness === undefined) {
    return { ...resolved, typeArguments, witnesses };
  }
  const inRequired = { declaration: resolved.function, typeArguments, witnesses };
  const met = closedInside(witness, inRequired, program);
  return { ...met, binding: composed(met.binding, resolved.binding) };
}

/**
 * A witness's `binding`, over its own parameters, taking the required function's in their order,
 * composed with the `required` binding the call through the requirement made (§3.10): each of the
 * witness's parameters takes what the call gave the required parameter it takes, or its own
 * default.
 */
function composed(binding: Binding, required: Binding): Binding {
  return binding.map((source) => {
    if (source.kind !== 'argument') {
      return source;
    }
    return required[source.index] ?? unreachable(`No required parameter ${source.index} is bound.`);
  });
}

function closeWitnesses(
  witnesses: Witnesses,
  within: Closing | undefined,
  program: Closer,
): Witnesses {
  return new Map(
    [...witnesses].map(([parameter, constraints]) => [
      parameter,
      constraints.map((calls) => calls.map((call) => closedInside(call, within, program))),
    ]),
  );
}
