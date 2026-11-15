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
 *   each instantiation: a `dispose` that runs as code (§7), for every value its code types and
 *   every type a call instantiates its callee at, at any depth of what such a value holds. Only a
 *   type naming the function's own type parameters is made anew per instantiation; any other is
 *   the same in all of them.
 */

import { type FunctionDeclaration, typeParametersOf } from '../../syntax/declarations/index.ts';
import type { NodeOf } from '../../syntax/tree/node.ts';
import type { Checker } from '../check.ts';
import { parametersIn } from '../types/parts/type-parts.ts';
import { heldTypes } from '../types/properties/held.ts';
import type { ParameterKey, Type } from '../types/type/index.ts';
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
  | 'disposalOf'
  | 'fieldsOf'
  | 'variantsOf'
  | 'sharedValueOf'
  | 'externHeldOf'
  | 'typeKeys'
  | 'typeRules'
>;

/** Every call `declaration`'s code reaches, at the node making it. */
export function reachedCalls(
  checker: ReachSeams,
  declaration: FunctionDeclaration,
): readonly ReachedCall[] {
  const bodies = [checker.bodyOf(declaration), checker.defaultsOf(declaration)];
  const written = bodies
    .flatMap((body) => body?.madeCalls() ?? [])
    .flatMap(({ site, call }) => callsMadeWith(call).map((each) => ({ site, call: each })));
  const made = [
    ...bodies.flatMap((body) => body?.madeTypes() ?? []),
    ...written.flatMap(({ site, call }) =>
      instantiatingTypesOf(call).map((type) => ({ site, type })),
    ),
  ];
  const own = new Set<ParameterKey>(typeParametersOf(declaration.typeParameters));
  const sites = new Map<Type, NodeOf<string>>();
  for (const { site, type } of made) {
    if (!sites.has(type) && parametersIn(type).some((parameter) => own.has(parameter))) {
      sites.set(type, site);
    }
  }
  const entries = [...sites].flatMap(([type, site]) =>
    entryCallsOf(checker, type).flatMap((call) =>
      callsMadeWith(call).map((each) => ({ site, call: each })),
    ),
  );
  return [...written, ...entries];
}

/** The calls the type entries of what a value of `type` holds run: a `dispose` run as code. */
function entryCallsOf(checker: ReachSeams, type: Type): readonly ResolvedCall[] {
  return heldTypes(checker, type).flatMap((part) => {
    if (part.kind !== 'nominal') {
      return [];
    }
    const { kind } = part.entity.declaration;
    const disposed = kind === 'SharedStructDeclaration' || kind === 'ExternStructDeclaration';
    const disposal = disposed ? checker.disposalOf(part) : undefined;
    return disposal?.kind === 'function' ? [disposal.call] : [];
  });
}
