/**
 * The prelude calls a wait is written through (proposal 8, Rule 5; lowering/calls/waits.ts), the
 * one statement of which function each case's types instantiate: lowering makes these calls, and
 * what a function's code reaches (reach.ts) counts them, so every analysis reading that sees each
 * instance a wait makes.
 *
 * - A case is what its `onAwait` gives its resolver, a `Resolver<T, K>`: the value it is given,
 *   `T`, and the kind its wait waits in, `K`.
 * - Every prelude function a wait calls takes the case's value, its kind, or both, never anything
 *   else, and none is constrained, so a call of one passes every argument by position.
 */

import { waitFunctions } from '../../../foundation/language/well-known/implicit-calls.ts';
import { languageModules, wellKnown } from '../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import type { Checker } from '../check.ts';
import { substitute } from '../types/parts/substitution.ts';
import type { Type } from '../types/type/index.ts';
import { wellKnownArguments } from '../types/type/well-known.ts';
import type { FunctionCall, ResolvedCall } from './resolved-call.ts';
import { callSubstitution } from './witness-closing.ts';

/** One case of a wait: the type of the value it is given, and the kind of its wait. */
export interface WaitCase {
  readonly value: Type;
  readonly mode: Type;
}

/** Which of a case's types each function a wait calls is instantiated at, in its order. */
const waitTypeArguments = {
  wait: ['mode'],
  caseInto: ['value'],
  caseResolver: ['value', 'mode'],
  caseTaken: ['value'],
  decided: ['mode'],
  parking: ['mode'],
} as const satisfies Record<keyof typeof waitFunctions, readonly (keyof WaitCase)[]>;

export type WaitFunction = keyof typeof waitFunctions;

/** The type arguments of `name`'s call at a case of `parts`; a wait's own calls need only its kind. */
export function waitArguments(
  name: WaitFunction,
  parts: Pick<WaitCase, 'mode'> & Partial<WaitCase>,
): readonly Type[] {
  return waitTypeArguments[name].map((part) => {
    const type = parts[part];
    return type ?? unreachable(`A wait's ${name} needs its case's ${part}.`);
  });
}

/** The case a resolver of type `resolver`, a `Resolver<T, K>`, decides; undefined for another type. */
export function waitCaseOf(
  checker: Pick<Checker, 'wellKnownType'>,
  resolver: Type,
): WaitCase | undefined {
  const [value, mode] = wellKnownArguments(checker, wellKnown.resolver, resolver) ?? [];
  return value === undefined || mode === undefined ? undefined : { value, mode };
}

/**
 * The case the recorded `onAwait` call `call` makes, of the resolver its function's second
 * parameter takes, as the call instantiates it; undefined where that is no resolver.
 */
export function waitCaseOfCall(
  checker: Pick<Checker, 'parametersOf' | 'typeRules' | 'wellKnownType'>,
  call: ResolvedCall,
): WaitCase | undefined {
  const done = checker.parametersOf(call.function)[1]?.type;
  return done === undefined
    ? undefined
    : waitCaseOf(checker, substitute(done, callSubstitution(call), checker.typeRules));
}

/** Every call a wait makes at `waited`, one of its cases. */
export function waitCalls(
  checker: Pick<Checker, 'languageFunctions' | 'parametersOf'>,
  waited: WaitCase,
): readonly FunctionCall[] {
  return (Object.keys(waitTypeArguments) as WaitFunction[]).flatMap((name) =>
    checker
      .languageFunctions(languageModules.prelude, waitFunctions[name])
      .map((declaration) => positionalCall(checker, declaration, waitArguments(name, waited))),
  );
}

/** A call of `declaration`, constrained by nothing, at `typeArguments`, its arguments by position. */
function positionalCall(
  checker: Pick<Checker, 'parametersOf'>,
  declaration: FunctionDeclaration,
  typeArguments: readonly Type[],
): FunctionCall {
  return {
    kind: 'function',
    function: declaration,
    typeArguments,
    witnesses: new Map(),
    binding: checker.parametersOf(declaration).map((_, index) => ({ kind: 'argument', index })),
  };
}
