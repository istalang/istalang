/**
 * What a generic function's code reaches (§8.1), as each of its instantiations will: the calls its
 * body and its defaults make, generic as checked, so the types in them may name the function's own
 * type parameters. The expansion rule judges a function by what it reaches
 * (rules/expansion/functions.ts), and lowering closes the same calls per instantiation
 * (witness-closing.ts), so what one counts the other makes.
 *
 * - Every call a written call makes, at any depth through the witnesses it passes, a requirement
 *   call included (`callsMadeWith`): which function that runs is its caller's witness.
 * - The prelude calls each case of a wait is written through, at the case's types, from the
 *   `onAwait` it makes (wait-calls.ts).
 * - The calls the type entries of the types it makes run, which lowering's type table makes for
 *   each instantiation: a `dispose` that runs as code (§16) and the codec writing an instance's
 *   outcome (§17.4), for every value its code types, its signature's, and every type a call
 *   instantiates its callee at, at any depth of what such a value holds. Only a type naming the
 *   function's own type parameters is made anew per instantiation; any other is the same in all.
 *   One held type is one entry, however many values hold it.
 * - An instance a callee makes whose outcome no codec writes for the callee's own type parameters
 *   is encoded by the codec its instantiation finds, so the call giving the type arguments reaches
 *   it, as that call instantiates it: only a call whose type arguments name the function's own
 *   type parameters makes it anew per instantiation, so only such a call reads its callee's code.
 */

import { wellKnown } from '../../../foundation/language/well-known/index.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import { type FunctionDeclaration, typeParametersOf } from '../../syntax/declarations/index.ts';
import type { NodeOf } from '../../syntax/tree/node.ts';
import type { Checker } from '../check.ts';
import { substitute, substitutionFor } from '../types/parts/substitution.ts';
import { parametersIn } from '../types/parts/type-parts.ts';
import { heldTypes } from '../types/properties/held.ts';
import type { ParameterKey, Type } from '../types/type/index.ts';
import { wellKnownArguments } from '../types/type/well-known.ts';
import {
  callsMadeWith,
  instantiatingTypesOf,
  type MadeCall,
  type ResolvedCall,
} from './resolved-call.ts';
import { waitCalls, waitCaseOfCall } from './wait-calls.ts';

/** A call a function's code reaches, and the node making it. */
interface ReachedCall {
  readonly site: NodeOf<string>;
  readonly call: ResolvedCall;
}

type ReachSeams = Pick<
  Checker,
  | 'bodyOf'
  | 'defaultsOf'
  | 'parametersOf'
  | 'resultOf'
  | 'disposalOf'
  | 'json'
  | 'languageFunctions'
  | 'wellKnownType'
  | 'fieldsOf'
  | 'variantsOf'
  | 'sharedValueOf'
  | 'externHeldOf'
  | 'typeKeys'
  | 'typeRules'
>;

/** A type a function's code makes, and the node making it. */
interface MadeType {
  readonly site: NodeOf<string>;
  readonly type: Type;
}

/** Every call `declaration`'s code reaches, at the node making it. */
export function reachedCalls(
  checker: ReachSeams,
  declaration: FunctionDeclaration,
): readonly ReachedCall[] {
  const own = new Set<ParameterKey>(typeParametersOf(declaration.typeParameters));
  const written = [checker.bodyOf(declaration), checker.defaultsOf(declaration)]
    .flatMap((body) => body?.madeCalls() ?? [])
    .flatMap((recorded) => [
      ...callsMadeWith(recorded.call).map((each) => ({ site: recorded.site, call: each })),
      ...waitCallsOf(checker, recorded).map((each) => ({ site: recorded.site, call: each })),
    ]);
  const left = new Map<FunctionDeclaration, readonly Type[]>();
  const leftBy = (call: ResolvedCall): readonly Type[] => {
    const renewed = call.kind === 'function' && call.typeArguments.some((type) => names(type, own));
    if (!renewed) {
      return [];
    }
    const substitution = substitutionFor(call.function.typeParameters, call.typeArguments);
    return memo(left, call.function, () => instancesLeftBy(checker, call.function)).map((type) =>
      substitute(type, substitution, checker.typeRules),
    );
  };
  const made = [
    ...written.flatMap(({ site, call }) =>
      [...instantiatingTypesOf(call), ...leftBy(call)].map((type) => ({ site, type })),
    ),
    ...typesMadeBy(checker, declaration),
  ];
  // One held type, however many nodes make it, is one entry: reached at the first node making it,
  // a call instantiating it before a value typed by it.
  const first = new Map<string, MadeType>();
  for (const { site, type } of made) {
    for (const held of heldTypes(checker, type)) {
      const key = checker.typeKeys.typeKey(held);
      if (!first.has(key) && names(held, own)) {
        first.set(key, { site, type: held });
      }
    }
  }
  const entries = [...first.values()].flatMap(({ type, site }) =>
    entryCallsOf(checker, type).flatMap((call) =>
      callsMadeWith(call).map((each) => ({ site, call: each })),
    ),
  );
  return [...written, ...entries];
}

/** The calls the wait `made`, an `onAwait` a case makes, is written through (wait-calls.ts). */
function waitCallsOf(checker: ReachSeams, made: MadeCall): readonly ResolvedCall[] {
  if (made.kind !== 'call' || made.role !== 'onAwait') {
    return [];
  }
  const waited = waitCaseOfCall(checker, made.call);
  return waited === undefined ? [] : waitCalls(checker, waited);
}

/** The types `declaration`'s code makes: each expression's its bodies type, and its signature's. */
function typesMadeBy(checker: ReachSeams, declaration: FunctionDeclaration): readonly MadeType[] {
  const bodies = [checker.bodyOf(declaration), checker.defaultsOf(declaration)];
  return [
    ...bodies.flatMap((body) => body?.madeTypes() ?? []),
    ...checker.parametersOf(declaration).map(({ node, type }) => ({ site: node, type })),
    { site: declaration.returnType ?? declaration.name, type: checker.resultOf(declaration) },
  ];
}

/**
 * The instances `callee` makes whose outcome no codec writes for its own type parameters: lowering
 * finds an instance's codec where an instantiation makes its outcome known (§17.4), so the code giving
 * the type arguments reaches it.
 */
function instancesLeftBy(checker: ReachSeams, callee: FunctionDeclaration): readonly Type[] {
  const parameters = new Set<ParameterKey>(typeParametersOf(callee.typeParameters));
  return typesMadeBy(checker, callee)
    .flatMap(({ type }) => heldTypes(checker, type))
    .filter((part) => {
      const outcome = outcomeOf(checker, part);
      return (
        outcome !== undefined &&
        names(outcome, parameters) &&
        checker.json.codecOf(outcome, 'write') === undefined
      );
    });
}

/**
 * The calls the type entries of a held `type` run: a `dispose` run as code (§16), and the codec
 * writing an instance's outcome for its host (§17.3).
 */
function entryCallsOf(checker: ReachSeams, type: Type): readonly ResolvedCall[] {
  if (type.kind !== 'nominal') {
    return [];
  }
  const outcome = outcomeOf(checker, type);
  const codec = outcome === undefined ? undefined : checker.json.codecOf(outcome, 'write');
  const { kind } = type.entity.declaration;
  const disposed = kind === 'SharedStructDeclaration' || kind === 'ExternStructDeclaration';
  const disposal = disposed ? checker.disposalOf(type) : undefined;
  return [
    ...(disposal?.kind === 'function' ? [disposal.call] : []),
    ...(codec === undefined ? [] : [codec]),
  ];
}

/** The outcome of an instance of `type`, an `Instance<T>`'s `T`; undefined for another type. */
function outcomeOf(checker: ReachSeams, type: Type): Type | undefined {
  return wellKnownArguments(checker, wellKnown.instance, type)?.[0];
}

/** Whether `type` names one of `parameters`. */
function names(type: Type, parameters: ReadonlySet<ParameterKey>): boolean {
  return parametersIn(type).some((parameter) => parameters.has(parameter));
}
