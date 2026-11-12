/**
 * Witness closing (§3.5, §3.10): a call the checker resolved inside a generic body, as one
 * instantiation of that body makes it. Lowering closes every call of an instance it compiles
 * (lowering/calls/closed-calls.ts), and an analysis summing a generic callee up at a call site
 * closes the callee's requirement calls with the witnesses that site gives: one algorithm, so the
 * two never disagree on what a call runs.
 *
 * - Type arguments naming the instance's own parameters are substituted, and a call to a
 *   requirement becomes the witness the instance was given for it, closed inside the requirement's
 *   own instance, its binding composed with the call's; a requirement on a computed type an
 *   instantiation made known takes that type's witness, which the program gives (`Closer`).
 * - A requirement on an `any` value, on a union's trait (§6), or on another function's type
 *   parameters stays open: the value's own type, or that function's call, decides it later.
 * - Instances are keyed by their types alone: witnesses are coherent, the same for the same types
 *   wherever they are found (§3.10).
 */

import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { type FunctionDeclaration, typeParametersOf } from '../../syntax/declarations/index.ts';
import type { Checker } from '../check.ts';
import {
  type Substitution,
  substitute,
  substituteAny,
  substitutionFor,
} from '../types/parts/substitution.ts';
import { isOpaque } from '../types/type/computed-types.ts';
import type { Type } from '../types/type/index.ts';
import { typeText } from '../types/type/type-text.ts';
import type { Binding, FunctionCall, ResolvedCall, Witnesses } from './resolved-call.ts';

/** A function as one instantiation runs it: its type arguments and its constraints' witnesses. */
export interface FunctionInstance {
  readonly declaration: FunctionDeclaration;
  readonly typeArguments: readonly Type[];
  readonly witnesses: Witnesses;
}

/**
 * What closing a call asks of the program: the rules its types are built by, and the witnesses a
 * type an instantiation made known meets a trait with, for a requirement on a computed type.
 */
export type Closer = Pick<Checker, 'typeRules' | 'traitObjects'>;

/**
 * What closing reads of the body a call is closed inside: how it maps type parameters, and the
 * witnesses its instance was given. A constant's value is within no instance, so it maps no type
 * parameter; lowering adds the keys of the field loops a body is lowered in to its substitution.
 */
export interface Closing {
  readonly substitution: Substitution;
  readonly witnesses: Witnesses;
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

/** How calls are closed inside `instance`; inside none, nothing is substituted. */
export function closingIn(instance: FunctionInstance | undefined): Closing {
  return instance === undefined
    ? { substitution: new Map(), witnesses: new Map() }
    : { substitution: substitutionOf(instance), witnesses: instance.witnesses };
}

/** The instance `call` runs of its function. */
export function instanceOf({ function: declaration, typeArguments, witnesses }: FunctionCall) {
  return { declaration, typeArguments, witnesses } satisfies FunctionInstance;
}

/** The instance `call`, a call to a function, runs once closed inside `within`. */
export function closedFunctionCall(
  call: FunctionCall,
  within: Closing,
  program: Closer,
): FunctionInstance {
  return instanceOf({
    ...call,
    typeArguments: call.typeArguments.map((type) =>
      substitute(type, within.substitution, program.typeRules),
    ),
    witnesses: closeWitnesses(call.witnesses, within, program),
  });
}

/**
 * `resolved` inside `within`: type arguments substituted, and a requirement on one of the
 * instance's type parameters the witness the instance was given for it, closed inside the
 * requirement's own instance. A requirement on another function's type parameters, such as one a
 * generic required function's own constraints make, stays open until that function's call closes
 * it, so an instance's witnesses may hold one.
 */
export function closedInside(
  resolved: ResolvedCall,
  within: Closing,
  program: Closer,
): ResolvedCall {
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
      program.traitObjects.memberWitnesses(through, 0, on)?.[origin.member] ??
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
