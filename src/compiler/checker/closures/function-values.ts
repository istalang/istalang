/**
 * Functions named as values (§3.14): a top-level function by its name, plain (`inc`) or through
 * a namespace (`math.inc`), or a static function through its type (`Duration.zero`). The three
 * forms are one rule: `namedFunctions` finds what a name means, and the value is a closure with
 * no captures, recorded as a site at the expression naming it (check.ts).
 *
 * - The expected function type chooses among the functions named, as a call with arguments of
 *   its parameter types would (resolution/choice.ts), and infers a generic one's type arguments
 *   from those and its result (§3.5). A shorter function type leaves trailing parameters to their
 *   defaults, which the value computes at each call (§3.3), and a rest parameter is one array
 *   (resolution/binding.ts).
 *   A top-level name also finds what argument-dependent lookup does from those types (§3.13).
 * - With no expected function type, only a lone non-generic function can be named; any other
 *   name needs one (§3.14), which a call it is passed to gives (`functionsAccepted`).
 * - A function's type as a value has the `T` an `await` yields as an async function's result.
 */

import { staticName } from '../../../language/static-names.ts';
import type { FunctionsEntity } from '../../binder/entities.ts';
import type { MemberAccess } from '../../syntax/expressions/index.ts';
import type { Identifier } from '../../syntax/node.ts';
import { recordChosen } from '../calls/resolve.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import {
  type Candidate,
  callCandidates,
  staticCandidates,
  staticTargetOf,
} from '../resolution/candidates.ts';
import {
  type Accepts,
  type Application,
  chooseAsValue,
  type Passing,
  signatureOf,
} from '../resolution/choice.ts';
import { instantiate } from '../resolution/conformance.ts';
import { namedType } from '../resolution/named.ts';
import { substitute } from '../types/substitution.ts';
import { errorType, type FunctionType, type Type, withPack } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { futureArgument, futureOf } from '../types/well-known.ts';
import { useSite } from '../use-site.ts';

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
    candidates: (expected) =>
      expected?.kind === 'function'
        ? callCandidates(
            checker,
            named,
            name.text,
            expected.parameters.map(({ type }) => type),
          )
        : named.map((declaration) => ({ declaration })),
  };
}

/** The type of the function `named` names as a value; the error type after a report. */
export function checkFunctionValue(
  context: BodyContext,
  named: NamedFunctions,
  expected: Type | undefined,
): Type {
  const { site, name } = named;
  const candidates = named.candidates(expected);
  const shape = expected?.kind === 'function' ? expected : undefined;
  const application =
    shape === undefined ? loneFunction(context, candidates) : chosenFor(context, candidates, shape);
  if (application === undefined) {
    context.report(checkerDiagnostics.functionValueUnchosen(site.span, name));
    return errorType;
  }
  const { checker } = context;
  const { signature, binding } = application;
  const expectedResult =
    shape === undefined || !signature.declaration.isAsync
      ? shape?.result
      : futureOf(checker, shape.result);
  const instantiation = instantiate(
    useSite(checker, context.module, site.span),
    application,
    expectedResult,
  );
  if (instantiation === undefined) {
    return errorType;
  }
  recordChosen(context, { site, application, instantiation });
  const { substitution } = instantiation;
  const result = substitute(signature.result(), substitution);
  const pack = signature.parameters.find((slot) => slot.rest?.kind === 'pack');
  return withPack(
    {
      kind: 'function',
      isSendable: true,
      isAsync: signature.declaration.isAsync,
      parameters: signature.parameters
        .filter((slot, index) => slot !== pack && binding[index]?.kind === 'argument')
        .map((slot) => ({ type: substitute(slot.type, substitution), reference: slot.reference })),
      result: signature.declaration.isAsync
        ? (futureArgument(checker, result) ?? errorType)
        : result,
    },
    pack === undefined ? undefined : substitute(pack.type, substitution),
  );
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
  return (expected) =>
    expected.kind === 'function' &&
    chosenFor(context, named.candidates(expected), expected) !== undefined;
}

/** The application of the one candidate, when there is one and it isn't generic. */
function loneFunction(
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
function chosenFor(
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
