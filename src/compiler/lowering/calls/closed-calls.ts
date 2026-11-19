/**
 * Closed calls (§8.1, §8.2): what a call the checker resolved inside a generic body targets in
 * one instance (tables/instances.ts) of that body, every type concrete. The checker closes it
 * (checker/surface/witness-closing.ts); this module says which entry a closed call runs.
 *
 * - A requirement on an `any` value, or a call through a union's trait (§8.2), stays a dispatch on
 *   the value's own type (`Dispatch`), which ../synthesized/trait-objects.ts writes once the
 *   program is reached.
 * - A closed call runs its function's entry with the call's binding, which computes the parameters
 *   the call leaves out (§6.1). A function named as a value is bound as its type calls it, by
 *   position, so its entry takes the arguments as passed, those after them absent (`leavesOut`).
 */

import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Checker, SignatureParameter } from '../../checker/check.ts';
import type { CheckedBody } from '../../checker/surface/checked-body.ts';
import type {
  Binding,
  FunctionCall,
  ResolvedCall,
  Witnesses,
} from '../../checker/surface/resolved-call.ts';
import {
  type Closer,
  type Closing,
  closedFunctionCall,
  closedInside,
  closingIn,
  type FunctionInstance,
  instanceOf,
  substitutionOf,
} from '../../checker/surface/witness-closing.ts';
import { type Substitution, substitute } from '../../checker/types/parts/substitution.ts';
import type { AnyType, Type } from '../../checker/types/type/index.ts';
import { typeText } from '../../checker/types/type/type-text.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import { type BodyOwner, ownerInstance } from '../tables/instances.ts';

/**
 * `resolved`, a call made inside `body`, which `owner` owns, closed there as `program` says: its
 * types read through the body's substitution, its witnesses the owner's instance's.
 */
export function closeCallWithin(
  resolved: ResolvedCall,
  { body, owner }: { readonly body: CheckedBody; readonly owner: BodyOwner },
  program: Closer,
): ClosedCall {
  const closing: Closing = {
    substitution: body.substitution,
    witnesses: ownerInstance(owner)?.witnesses ?? new Map(),
  };
  return closedCall(closedInside(resolved, closing, program));
}

/**
 * Whether a function value naming `call`'s function leaves parameters out (§6.4): its type passes
 * fewer than the function takes, the rest left to their defaults and an array's rest empty, which
 * its entry computes from nothing passed.
 */
export function leavesOut(
  checker: Pick<Checker, 'parametersOf'>,
  call: ClosedFunctionCall,
): boolean {
  const parameters = checker.parametersOf(call.instance.declaration);
  return call.binding.some(
    (source, index) =>
      source.kind === 'default' ||
      (source.kind === 'rest' &&
        source.items.length === 0 &&
        parameters[index]?.rest?.kind === 'array'),
  );
}

/**
 * What a call closed inside an instance targets, every type in it concrete: a function's own
 * entry, with which argument each of its parameters takes (§6.1), or a dispatch on the own type of
 * the `any` value it is called with, which passes every argument by position (§8.3).
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

/** What `call` gives, of the type its function's result is in its instance, or its dispatch. */
export function resultOfCall(
  checker: Pick<Checker, 'resultOf' | 'typeRules' | 'traitObjects'>,
  call: ClosedCall,
): Type {
  const declaration = call.kind === 'dispatch' ? call.dispatch.required : call.instance.declaration;
  return substitute(
    checker.resultOf(declaration),
    substitutionOfCall(checker, call),
    checker.typeRules,
  );
}

/** How `call`'s function maps its type parameters: its instance's, or its dispatch's. */
export function substitutionOfCall(
  checker: Pick<Checker, 'traitObjects'>,
  call: ClosedCall,
): Substitution {
  return call.kind === 'function'
    ? substitutionOf(call.instance)
    : dispatchSubstitution(checker, call.dispatch);
}

/**
 * How a dispatch maps its required function's types: the trait's parameters and `Self` as the
 * constraint it is called through gives them, and the function's own as the call does.
 */
export function dispatchSubstitution(
  checker: Pick<Checker, 'traitObjects'>,
  { through, constraint, on, required, typeArguments }: Dispatch,
): Substitution {
  return checker.traitObjects.callSubstitution(through, constraint, on, {
    required,
    typeArguments,
  });
}

/** A closed call of a function: its own entry's instance, and the call's binding. */
interface ClosedFunctionCall {
  readonly kind: 'function';
  readonly instance: FunctionInstance;
  readonly binding: Binding;
}

/**
 * A call dispatched on a value's own type: the `member`-th function of the trait of the
 * `constraint`-th constraint of the `any` type `through`, with its own type arguments and the
 * witnesses of their constraints, every type concrete. The value is of `on`: `through` itself for
 * an `any` value; for a call through a union's trait (§8.2), the union, or the one type an
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

/** What `resolved` targets, closed inside `within`, as `program` says (`Closer`). */
export function closeCall(
  resolved: ResolvedCall,
  within: FunctionInstance | undefined,
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
  within: FunctionInstance | undefined,
  program: Closer,
): FunctionInstance {
  return closedFunctionCall(call, closingIn(within), program);
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
