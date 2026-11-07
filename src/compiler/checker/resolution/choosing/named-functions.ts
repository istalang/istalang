/**
 * Functions named as values (§3.14): which functions a name means, and which of them, chosen by
 * the function type expected, as a call passing that type's parameters would choose it
 * (choice.ts). A top-level function is named by its name, plain (`inc`) or through a namespace
 * (`math.inc`), a static function through its type (`Duration.zero`), and a variant with fields,
 * its enum's constructor (§3.11), qualified (`Result.Ok`) or bare (`Ok`), whose enum is then the
 * one the expected function type's result is: a variant without fields is a value, never a
 * function. Nothing here records or reports, so checking a function value
 * (constructs/closures/function-values.ts) and inferring a call's type parameters from one passed
 * to it (../calls/function-arguments.ts) choose it alike.
 *
 * - The expected function type chooses among the functions named, and infers a generic one's
 *   type arguments from its parameters and its result (§3.5). A shorter function type leaves
 *   trailing parameters to their defaults, which the value computes at each call (§3.3), and a
 *   rest parameter is one array (binding.ts). A top-level name also finds what argument-dependent
 *   lookup does from those types (§3.13).
 * - With no expected function type, only a lone non-generic function can be named; any other
 *   name needs one (§3.14), which a call it is passed to gives (`functionsAccepted`), as it does
 *   for a lone one with defaults, whose type the parameter it fills decides.
 * - A function's type as a value has the `T` an `await` yields as an async function's result.
 */

import { staticName } from '../../../../foundation/language/static-names.ts';
import type { Entity, FunctionsEntity, VariantNaming } from '../../../binder/entities.ts';
import { fieldsFunctionOf } from '../../../syntax/declarations/field-defaults.ts';
import type { MemberAccess } from '../../../syntax/expressions/index.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import type { Accepts, BodyContext } from '../../contexts/body-context.ts';
import { searchSite, type UseSite } from '../../contexts/use-site.ts';
import { enumsExpected, expectedFunction } from '../../types/fitting/expected.ts';
import { substitute } from '../../types/parts/substitution.ts';
import { withPack } from '../../types/type/function-types.ts';
import type { FunctionType, Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type/type-text.ts';
import { futureArgument, futureOf } from '../../types/type/well-known.ts';
import { namedType } from '../../types/written/named-types.ts';
import { type Instantiation, instantiate } from '../conformance/conformance.ts';
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
 * namespace, a type's static functions, or a variant's constructor; undefined for anything else.
 */
export function namedFunctions(
  context: BodyContext,
  node: Identifier | MemberAccess,
): NamedFunctions | undefined {
  if (node.kind === 'Identifier') {
    return namedBy(context, node, context.entityOf(node));
  }
  if (node.isOptional) {
    return undefined;
  }
  const qualified = context.entityOf(node.member);
  if (qualified !== undefined) {
    return namedBy(context, node, qualified);
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

/** The functions `entity`, what `site` names, is: a top-level set, or a variant's constructor. */
function namedBy(
  context: BodyContext,
  site: Identifier | MemberAccess,
  entity: Entity | undefined,
): NamedFunctions | undefined {
  switch (entity?.kind) {
    case 'functions':
      return topLevelFunctions(context, site, entity);
    case 'variant':
    case 'variants':
      return variantConstructors(context, site, entity);
    default:
      return undefined;
  }
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
 * The constructor a variant's name may mean (§3.11): a qualified variant's own, or, for a bare
 * name, that of the variant of the enum an expected function type's result is. Undefined when no
 * variant so named has fields, since a variant without fields is a value, not a function.
 */
function variantConstructors(
  context: BodyContext,
  site: Identifier | MemberAccess,
  naming: VariantNaming,
): NamedFunctions | undefined {
  const { checker } = context;
  const named = naming.kind === 'variant' ? [naming] : checker.bindings.candidatesOf(naming);
  if (named.every((each) => fieldsFunctionOf(each.enum, each.variant) === undefined)) {
    return undefined;
  }
  return {
    site,
    name:
      naming.kind === 'variant'
        ? staticName(naming.enum.name.text, naming.variant.name.text)
        : naming.name,
    candidates: (expected) => {
      const chosen =
        naming.kind === 'variant'
          ? naming
          : checker.inputs.variantNamed(
              naming.name,
              enumsExpected(expectedFunction(expected)?.result),
            );
      const constructs = chosen && fieldsFunctionOf(chosen.enum, chosen.variant);
      return constructs === undefined ? [] : [{ declaration: constructs }];
    },
  };
}

/**
 * The type of the function `node` names as a value where one taking `shape`'s parameters is
 * expected and its result is still to be found, as a call it is passed to finds it (§3.5);
 * undefined when it names none, or none such is chosen or can be instantiated. It records and
 * reports nothing.
 */
export function functionValueType(
  context: BodyContext,
  node: Identifier | MemberAccess,
  shape: FunctionType,
): FunctionType | undefined {
  const named = namedFunctions(context, node);
  const application = named === undefined ? undefined : chosenValue(context, named, shape);
  return application === undefined
    ? undefined
    : instantiatedValue(context, application, searchSite(context.checker), undefined)?.type;
}

/** The function `named` means taking `shape`'s parameters, or its lone function with no shape. */
export function chosenValue(
  context: BodyContext,
  named: NamedFunctions,
  shape: FunctionType | undefined,
): Application | undefined {
  const candidates = named.candidates(shape);
  return shape === undefined
    ? loneFunction(context, candidates)
    : chosenFor(context, candidates, shape);
}

/**
 * `application` instantiated at `site`, its result expected to be `result`, with its type as a
 * value; undefined when it can't be, which `site` reports.
 */
export function instantiatedValue(
  context: BodyContext,
  application: Application,
  site: UseSite,
  result: Type | undefined,
): { readonly instantiation: Instantiation; readonly type: FunctionType } | undefined {
  const { checker } = context;
  const { signature, binding } = application;
  const { isAsync } = signature.declaration;
  const expectedResult = result === undefined || !isAsync ? result : futureOf(checker, result);
  const instantiation = instantiate(site, application, expectedResult);
  if (instantiation === undefined) {
    return undefined;
  }
  const { substitution } = instantiation;
  const made = substitute(signature.result(), substitution, checker.typeRules);
  const pack = signature.parameters.find((slot) => slot.rest?.kind === 'pack');
  const type = withPack(
    {
      kind: 'function',
      isSendable: true,
      isAsync,
      parameters: signature.parameters
        .filter((slot, index) => slot !== pack && binding[index]?.kind === 'argument')
        .map((slot) => ({
          type: substitute(slot.type, substitution, checker.typeRules),
          reference: slot.reference,
        })),
      result: isAsync ? (futureArgument(checker, made) ?? errorType) : made,
    },
    pack === undefined ? undefined : substitute(pack.type, substitution, checker.typeRules),
  );
  return { instantiation, type };
}

/**
 * For functions named as an argument, the function types they can be passed as, so the call
 * decides which (§3.5); undefined for a lone non-generic function without defaults, which has one
 * type of its own, while one with defaults also fits the types leaving them out (§3.14).
 */
export function functionsAccepted(
  context: BodyContext,
  named: NamedFunctions,
): Accepts | undefined {
  const lone = loneFunction(context, named.candidates(undefined));
  if (lone?.signature.parameters.every((slot) => !slot.hasDefault) === true) {
    return undefined;
  }
  return (expected) => {
    const shape = expectedFunction(expected);
    return shape !== undefined && chosenFor(context, named.candidates(shape), shape) !== undefined;
  };
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
