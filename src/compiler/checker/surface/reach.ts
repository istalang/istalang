/**
 * What a generic function's code reaches (§3.5), as each of its instantiations will: the calls its
 * body and its defaults make, generic as checked, so the types in them may name the function's own
 * type parameters. The expansion rule judges a function by what it reaches
 * (rules/expansion/functions.ts), and lowering closes the same calls per instantiation
 * (witness-closing.ts), so what one counts the other makes.
 *
 * - Every call a written call makes, at any depth through the witnesses it passes, a requirement
 *   call included (`callsMadeWith`): which function that runs is its caller's witness.
 * - The calls the type entries of the types it makes run, which lowering's type table makes for
 *   each instantiation: a `dispose` that runs as code (§7) and the codec writing an instance's
 *   outcome (§9), for every value its code types, its signature's, and every type a call
 *   instantiates its callee at, at any depth of what such a value holds. Only a type naming the
 *   function's own type parameters is made anew per instantiation; any other is the same in all.
 * - An instance a callee makes whose outcome no codec writes for the callee's own type parameters
 *   is encoded by the codec its instantiation finds, so the call giving the type arguments reaches
 *   it, as that call instantiates it.
 */

import { wellKnown } from '../../../foundation/language/well-known/index.ts';
import { type FunctionDeclaration, typeParametersOf } from '../../syntax/declarations/index.ts';
import type { NodeOf } from '../../syntax/tree/node.ts';
import type { Checker } from '../check.ts';
import { substitute, substitutionFor } from '../types/parts/substitution.ts';
import { parametersIn } from '../types/parts/type-parts.ts';
import { heldTypes } from '../types/properties/held.ts';
import type { ParameterKey, Type } from '../types/type/index.ts';
import { wellKnownArguments } from '../types/type/well-known.ts';
import { callsMadeWith, instantiatingTypesOf, type ResolvedCall } from './resolved-call.ts';

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
  const written = [checker.bodyOf(declaration), checker.defaultsOf(declaration)]
    .flatMap((body) => body?.madeCalls() ?? [])
    .flatMap(({ site, call }) => callsMadeWith(call).map((each) => ({ site, call: each })));
  const made = [
    ...typesMadeBy(checker, declaration),
    ...written.flatMap(({ site, call }) =>
      [...instantiatingTypesOf(call), ...instancesLeftBy(checker, call)].map((type) => ({
        site,
        type,
      })),
    ),
  ];
  const own = new Set<ParameterKey>(typeParametersOf(declaration.typeParameters));
  // One type, however many nodes make it, is one entry: reached at the first node making it.
  const first = new Map<string, MadeType>();
  for (const each of made) {
    const key = checker.typeKeys.typeKey(each.type);
    if (!first.has(key) && names(each.type, own)) {
      first.set(key, each);
    }
  }
  const entries = [...first.values()].flatMap(({ type, site }) =>
    entryCallsOf(checker, type).flatMap((call) =>
      callsMadeWith(call).map((each) => ({ site, call: each })),
    ),
  );
  return [...written, ...entries];
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
 * The instances `call`'s callee makes whose outcome no codec writes for its own type parameters,
 * as `call` instantiates them: lowering finds an instance's codec where an instantiation makes its
 * outcome known (§9), so the code giving the type arguments reaches it.
 */
function instancesLeftBy(checker: ReachSeams, call: ResolvedCall): readonly Type[] {
  const callee = call.function;
  const parameters = new Set<ParameterKey>(typeParametersOf(callee.typeParameters));
  if (call.kind !== 'function' || parameters.size === 0) {
    return [];
  }
  const substitution = substitutionFor(callee.typeParameters, call.typeArguments);
  return typesMadeBy(checker, callee)
    .flatMap(({ type }) => heldTypes(checker, type))
    .filter((part) => {
      const outcome = outcomeOf(checker, part);
      return (
        outcome !== undefined &&
        names(outcome, parameters) &&
        checker.json.codecOf(outcome, 'write') === undefined
      );
    })
    .map((part) => substitute(part, substitution, checker.typeRules));
}

/**
 * The calls the type entries of what a value of `type` holds run: a `dispose` run as code (§7),
 * and the codec writing an instance's outcome for its host (§9).
 */
function entryCallsOf(checker: ReachSeams, type: Type): readonly ResolvedCall[] {
  return heldTypes(checker, type).flatMap((part) => {
    const outcome = outcomeOf(checker, part);
    const codec = outcome === undefined ? undefined : checker.json.codecOf(outcome, 'write');
    if (part.kind !== 'nominal') {
      return [];
    }
    const { kind } = part.entity.declaration;
    const disposed = kind === 'SharedStructDeclaration' || kind === 'ExternStructDeclaration';
    const disposal = disposed ? checker.disposalOf(part) : undefined;
    return [
      ...(disposal?.kind === 'function' ? [disposal.call] : []),
      ...(codec === undefined ? [] : [codec]),
    ];
  });
}

/** The outcome of an instance of `type`, an `Instance<T>`'s `T`; undefined for another type. */
function outcomeOf(checker: ReachSeams, type: Type): Type | undefined {
  return wellKnownArguments(checker, wellKnown.instance, type)?.[0];
}

/** Whether `type` names one of `parameters`. */
function names(type: Type, parameters: ReadonlySet<ParameterKey>): boolean {
  return parametersIn(type).some((parameter) => parameters.has(parameter));
}
