/**
 * Closing a call (§3.5, §3.10): what a call the checker resolved inside a generic body targets in
 * one instance (tables/instances.ts) of that body, every type concrete.
 *
 * - Type arguments naming the instance's own parameters are substituted, and a call to a
 *   requirement becomes the witness the instance was given for it, closed inside the requirement's
 *   own instance; a requirement on a computed type an instantiation made known takes that type's
 *   witness, which the program gives (`Closer`).
 * - A requirement on an `any` value, or a call through a union's trait (§6), stays a dispatch on
 *   the value's own type (`Dispatch`), which ../trait-objects/ writes once the program is reached.
 * - A closed call runs its function's own entry with the call's binding; an entry handed out to be
 *   called later takes the arguments as passed (`takingPassed`), a filling entry when the call
 *   leaves parameters out or passes them out of order.
 */

import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Checker, SignatureParameter } from '../../checker/check.ts';
import {
  type Binding,
  type FunctionCall,
  passesAll,
  type ResolvedCall,
  type Witnesses,
} from '../../checker/surface/resolved-call.ts';
import {
  type Substitution,
  substitute,
  substituteAny,
  substitutionFor,
} from '../../checker/types/parts/substitution.ts';
import { isOpaque } from '../../checker/types/type/computed-types.ts';
import type { AnyType, Type } from '../../checker/types/type/index.ts';
import { typeText } from '../../checker/types/type/type-text.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import {
  type BodyOwner,
  type FunctionInstance,
  ownEntry,
  ownerSubstitution,
  substitutionOf,
} from '../tables/instances.ts';

/** `resolved`, a call made inside the body `within` owns, closed there as `program` says. */
export function closeCallWithin(
  resolved: ResolvedCall,
  within: BodyOwner,
  program: Closer,
): ClosedCall {
  const instance = within.kind === 'function' ? within.instance : undefined;
  const closing = {
    substitution: ownerSubstitution(within),
    witnesses: instance?.witnesses ?? new Map(),
  };
  return closedCall(closedInside(resolved, closing, program));
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

/** An instance a call is closed inside: its declaration, type arguments and witnesses. */
type ClosingInstance = Pick<FunctionInstance, 'declaration' | 'typeArguments' | 'witnesses'>;

/**
 * What closing reads of the body a call is closed inside: how it maps type parameters, the keys of
 * the field loops it is lowered in among them (tables/instances.ts `passBindings`), and the
 * witnesses its instance was given. A constant's value is within no instance, so it maps no type
 * parameter.
 */
interface Closing {
  readonly substitution: Substitution;
  readonly witnesses: Witnesses;
}

/** How calls are closed inside `instance`; inside none, nothing is substituted. */
function closingIn(instance: ClosingInstance | undefined): Closing {
  return instance === undefined
    ? { substitution: new Map(), witnesses: new Map() }
    : { substitution: substitutionOf(instance), witnesses: instance.witnesses };
}

/** What `resolved` targets, closed inside `within`, as `program` says (`Closer`). */
export function closeCall(
  resolved: ResolvedCall,
  within: ClosingInstance | undefined,
  program: Closer,
): ClosedCall {
  return closedCall(closedInside(resolved, closingIn(within), program));
}

/** What `closed`, a call closed as far as it goes, targets: an instance, or a dispatch. */
function closedCall(closed: ResolvedCall): ClosedCall {
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
  within: ClosingInstance | undefined,
  program: Closer,
): FunctionInstance {
  return closedFunctionCall(call, closingIn(within), program);
}

function closedFunctionCall(call: FunctionCall, within: Closing, program: Closer) {
  const { substitution } = within;
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
function closedInside(resolved: ResolvedCall, within: Closing, program: Closer): ResolvedCall {
  const { substitution } = within;
  if (resolved.kind === 'function') {
    const { typeArguments, witnesses } = closedFunctionCall(resolved, within, program);
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
    const inRequired = closingIn({ declaration: resolved.function, typeArguments, witnesses });
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
  const witness = within.witnesses.get(on)?.[constraint]?.[member];
  if (witness === undefined) {
    return { ...resolved, typeArguments, witnesses };
  }
  const inRequired = closingIn({ declaration: resolved.function, typeArguments, witnesses });
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

function closeWitnesses(witnesses: Witnesses, within: Closing, program: Closer): Witnesses {
  return new Map(
    [...witnesses].map(([parameter, constraints]) => [
      parameter,
      constraints.map((calls) => calls.map((call) => closedInside(call, within, program))),
    ]),
  );
}
