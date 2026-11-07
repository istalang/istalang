/**
 * Functions named as values (§3.14): which functions a name means, and which of them, chosen by
 * the function type expected, as a call passing that type's parameters would choose it
 * (choice.ts). A top-level function is named by its name, plain (`inc`) or through a namespace
 * (`math.inc`), and a static function through its type (`Duration.zero`). Nothing here records or
 * reports, so checking a function value (constructs/closures/function-values.ts) chooses it as
 * choosing a call's candidates does.
 *
 * - The expected function type chooses among the functions named, and infers a generic one's
 *   type arguments from its parameters and its result (§3.5). A shorter function type leaves
 *   trailing parameters to their defaults, which the value computes at each call (§3.3), and a
 *   rest parameter is one array (binding.ts). A top-level name also finds what argument-dependent
 *   lookup does from those types (§3.13).
 * - With no expected function type, only a lone non-generic function can be named; any other
 *   name needs one (§3.14), which a call it is passed to gives (`functionsAccepted`).
 */

import { staticName } from '../../../../foundation/language/static-names.ts';
import type { FunctionsEntity } from '../../../binder/entities.ts';
import type { MemberAccess } from '../../../syntax/expressions/index.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import type { Accepts, BodyContext } from '../../contexts/body-context.ts';
import { expectedFunction } from '../../types/fitting/expected.ts';
import type { FunctionType, Type } from '../../types/type/index.ts';
import { typeText } from '../../types/type/type-text.ts';
import { namedType } from '../../types/written/named-types.ts';
import type { Passing } from './call-arguments.ts';
import { type Candidate, callCandidates, staticCandidates, staticTargetOf } from './candidates.ts';
import { type Application, chooseAsValue, signatureOf } from './choice.ts';

/** Functions an expression names as a value: where, by what name in messages, and which. */
export interface NamedFunctions {
  readonly site: Identifier | MemberAccess;
  readonly name: string;
  /** The functions it may mean where a value of `expected` is wanted. */
  readonly candidates: (expected: Type | undefined) => readonly Candidate[];
}

/**
 * The functions `node` names, when it names functions: a top-level name, plain or through a
 * namespace, or a type's static functions; undefined for anything else.
 */
export function namedFunctions(
  context: BodyContext,
  node: Identifier | MemberAccess,
): NamedFunctions | undefined {
  if (node.kind === 'Identifier') {
    const entity = context.entityOf(node);
    return entity?.kind === 'functions' ? topLevelFunctions(context, node, entity) : undefined;
  }
  if (node.isOptional) {
    return undefined;
  }
  const qualified = context.entityOf(node.member);
  if (qualified !== undefined) {
    return qualified.kind === 'functions' ? topLevelFunctions(context, node, qualified) : undefined;
  }
  const owner = namedType(context, node.target);
  const target = owner === undefined ? undefined : staticTargetOf(context.checker, owner);
  if (owner === undefined || target === undefined) {
    return undefined;
  }
  const name = node.member.text;
  const candidates = staticCandidates(context.checker, context.module, target, name);
  return candidates.length === 0
    ? undefined
    : { site: node, name: staticName(typeText(owner), name), candidates: () => candidates };
}

/** A top-level function set named at `site`: its overloads, and what ADL finds for a call. */
function topLevelFunctions(
  context: BodyContext,
  site: Identifier | MemberAccess,
  entity: FunctionsEntity,
): NamedFunctions {
  const { checker } = context;
  const name = site.kind === 'Identifier' ? site : site.member;
  const named = checker.bindings.overloadsOf(entity);
  return {
    site,
    name: name.text,
    candidates: (expected) => {
      const shape = expectedFunction(expected);
      return shape === undefined
        ? named.map((declaration) => ({ declaration }))
        : callCandidates(
            checker,
            named,
            name.text,
            shape.parameters.map(({ type }) => type),
          );
    },
  };
}

/**
 * For functions named as an argument, the function types they can be passed as, so the call
 * decides which (§3.5); undefined for a lone non-generic function, which has its own type.
 */
export function functionsAccepted(
  context: BodyContext,
  named: NamedFunctions,
): Accepts | undefined {
  if (loneFunction(context, named.candidates(undefined)) !== undefined) {
    return undefined;
  }
  return (expected) => {
    const shape = expectedFunction(expected);
    return shape !== undefined && chosenFor(context, named.candidates(shape), shape) !== undefined;
  };
}

/** The application of the one candidate, when there is one and it isn't generic. */
export function loneFunction(
  context: BodyContext,
  candidates: readonly Candidate[],
): Application | undefined {
  const [only, ...others] = candidates;
  if (only === undefined || others.length > 0) {
    return undefined;
  }
  const signature = signatureOf(context.checker, only.declaration, only.requirement?.substitution);
  if (signature.typeParameters.length > 0) {
    return undefined;
  }
  const arguments_ = signature.parameters.map((slot) => ({
    type: slot.type,
    passing: passingOf(slot.reference),
  }));
  const choice = chooseAsValue(context.checker, [only], arguments_);
  return choice.kind === 'chosen' ? choice.application : undefined;
}

/**
 * The candidate that takes `shape`'s parameters, as a call passing them would choose it; none for
 * a shape ending in a pack, whose parameters are known only once a function is chosen (§3.5).
 */
export function chosenFor(
  context: BodyContext,
  candidates: readonly Candidate[],
  shape: FunctionType,
): Application | undefined {
  if (shape.pack !== undefined) {
    return undefined;
  }
  const arguments_ = shape.parameters.map((slot) => ({
    type: slot.type,
    passing: passingOf(slot.reference),
  }));
  const choice = chooseAsValue(context.checker, candidates, arguments_);
  return choice.kind === 'chosen' ? choice.application : undefined;
}

function passingOf(reference: boolean): Passing {
  return reference ? 'reference' : 'value';
}
