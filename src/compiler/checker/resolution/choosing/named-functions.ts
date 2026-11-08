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
 * - Type arguments written after the name (`parse<Int>`, `Result.Ok<Int, String>`) are taken as a
 *   call takes them (§3.5): they choose among the functions as the call's would, by their count,
 *   and fix the type parameters they give, the expected type inferring the rest.
 * - With no expected function type, only a lone function can be named, non-generic or given type
 *   arguments that suit it alone; any other name needs one (§3.14), which a call it is passed to
 *   gives (`functionsAccepted`). A lone one whose parameters don't take the expected type's is its
 *   own function all the same, so the type it is expected as reports the mismatch, as for any
 *   value.
 * - A function value's parameters take exactly the expected type's, with none of a call's
 *   conversions (§3.14): a value of `fn(Int?)` is no `fn(Int)`.
 * - A function's type as a value has the `T` an `await` yields as an async function's result.
 */

import { staticName } from '../../../../foundation/language/static-names.ts';
import type { Entity, FunctionsEntity, VariantNaming } from '../../../binder/entities.ts';
import {
  declaredFunctionName,
  fieldsFunctionOf,
} from '../../../syntax/declarations/field-defaults.ts';
import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import type { MemberAccess, TypeApplication } from '../../../syntax/expressions/index.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import type { Accepts, BodyContext } from '../../contexts/body-context.ts';
import { searchSite, type UseSite } from '../../contexts/use-site.ts';
import { enumsExpected, expectedFunction } from '../../types/fitting/expected.ts';
import { type Substitution, substitute } from '../../types/parts/substitution.ts';
import { parametersIn } from '../../types/parts/type-parts.ts';
import { withPack } from '../../types/type/function-types.ts';
import type { FunctionType, Type } from '../../types/type/index.ts';
import { errorType, tupleElements } from '../../types/type/primitives.ts';
import type { TypeRules } from '../../types/type/type-rules.ts';
import { typeText } from '../../types/type/type-text.ts';
import { futureArgument, futureOf } from '../../types/type/well-known.ts';
import { namedType } from '../../types/written/named-types.ts';
import { parameterType } from '../../types/written/resolve-type.ts';
import { type Instantiation, instantiate } from '../conformance/conformance.ts';
import { typeArgumentsInapplicability, writtenFor } from './applicability.ts';
import type { CallArgument, Passing, SignatureSlot } from './call-arguments.ts';
import { type Candidate, callCandidates, staticCandidates, staticTargetOf } from './candidates.ts';
import { type Application, type Choice, chooseAsValue, signatureOf } from './choice.ts';

/**
 * Functions an expression names as a value: where, by what name in messages, which, and any type
 * arguments written after the name.
 */
export interface NamedFunctions {
  readonly site: FunctionNaming;
  readonly name: string;
  /** The functions it may mean where a value of `expected` is wanted. */
  readonly candidates: (expected: Type | undefined) => readonly Candidate[];
  readonly written?: readonly Type[] | undefined;
}

/** What may name functions as a value: a name, plain or qualified, maybe given type arguments. */
export type FunctionNaming = Identifier | MemberAccess | TypeApplication;

/**
 * The functions `node` names, when it names functions: a top-level name, plain or through a
 * namespace, a type's static functions, or a variant's constructor, with any type arguments written
 * after it; undefined for anything else.
 */
export function namedFunctions(
  context: BodyContext,
  node: FunctionNaming,
): NamedFunctions | undefined {
  if (node.kind === 'TypeApplication') {
    const named = namedFunctions(context, node.target);
    const written = node.typeArguments.map((argument) => context.resolveType(argument));
    return named === undefined ? undefined : { ...named, site: node, written };
  }
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
 * The constructor a variant's name may mean (§3.11): a qualified variant's own, undefined for one
 * without fields, a value and never a function; or, for a bare name, that of the variant of the
 * enum an expected function type's result is, found by name among those enums only, as a bare
 * variant is (program-inputs.ts), so no other enum's variants are read.
 */
function variantConstructors(
  context: BodyContext,
  site: Identifier | MemberAccess,
  naming: VariantNaming,
): NamedFunctions | undefined {
  const { checker } = context;
  if (naming.kind === 'variant') {
    const constructs = fieldsFunctionOf(naming.enum, naming.variant);
    return constructs === undefined
      ? undefined
      : {
          site,
          name: declaredFunctionName(constructs),
          candidates: () => [{ declaration: constructs }],
        };
  }
  return {
    site,
    name: naming.name,
    candidates: (expected) => {
      const enums = enumsExpected(expectedFunction(expected)?.result);
      const chosen = checker.inputs.variantNamed(naming.name, enums);
      const constructs = chosen && fieldsFunctionOf(chosen.enum, chosen.variant);
      return constructs === undefined ? [] : [{ declaration: constructs }];
    },
  };
}

/** Which parts of an expected type a call is still finding, as choosing asks them (§3.5). */
export type OpenParts = (part: Type) => boolean;

/**
 * The type of the function `node` names as a value where a value of `shape` is expected, as a call
 * it is passed to judges it (§3.5): chosen by `shape`'s parameters, instantiated against its result
 * and fitting it, the parts `isOpen` says the call is still finding taken as anything; with no
 * shape, nothing giving the parameters, a lone non-generic function's whole type. Undefined when it
 * names none, or none fits. It records and reports nothing.
 */
export function functionValueType(
  context: BodyContext,
  node: FunctionNaming,
  shape: FunctionType | undefined,
  isOpen: OpenParts,
): FunctionType | undefined {
  const named = namedFunctions(context, node);
  return named === undefined ? undefined : fittedValue(context, named, shape, isOpen);
}

/**
 * `functionValueType` of what `named` means. Its result fits `shape`'s where that is known whole;
 * where a call is still finding part of it, instantiating matched what is known of it.
 */
function fittedValue(
  context: BodyContext,
  named: NamedFunctions,
  shape: FunctionType | undefined,
  isOpen: OpenParts,
): FunctionType | undefined {
  const { checker } = context;
  const site = searchSite(checker);
  if (shape === undefined) {
    const lone = loneFunction(context, named, undefined);
    return lone === undefined ? undefined : instantiatedValue(context, lone, site, undefined)?.type;
  }
  const holes = holesIn(shape, isOpen);
  const known = holes.size === 0 ? shape : substitute(shape, holes, checker.typeRules);
  const knownShape = known.kind === 'function' ? known : shape;
  const application = chosenFor(context, named, knownShape);
  const value =
    application === undefined
      ? undefined
      : instantiatedValue(context, application, site, knownShape.result)?.type;
  const isWhole = parametersIn(shape.result).every((parameter) => !holes.has(parameter));
  return value !== undefined && (!isWhole || checker.fitOf(value, shape) !== undefined)
    ? value
    : undefined;
}

/**
 * The parameters `type` mentions that `isOpen` says a call is still finding, each read as the
 * error type, which fits anything and binds nothing (types/inference/infer.ts), so only what is
 * known of `type` is matched.
 */
function holesIn(type: Type, isOpen: OpenParts): Substitution {
  return new Map(
    parametersIn(type)
      .filter((parameter) => isOpen(parameterType(parameter)))
      .map((parameter) => [parameter, errorType] as const),
  );
}

/**
 * The function `named` means taking `shape`'s parameters, else its lone function (`loneFunction`),
 * whatever its parameters are.
 */
export function chosenValue(
  context: BodyContext,
  named: NamedFunctions,
  shape: FunctionType | undefined,
): Application | undefined {
  const chosen = shape === undefined ? undefined : chosenFor(context, named, shape);
  return chosen ?? loneFunction(context, named, shape);
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
 * decides which (§3.5): those whose parameters choose one that, instantiated, fits the type, or,
 * while the call is still finding a parameter's type, those whose count one takes. Undefined for a
 * lone function of one type of its own (`hasOwnType`); a lone one with defaults or a rest fits the
 * types leaving them out too (§3.14), and one whose written type arguments leave a defaulted type
 * parameter open takes it from the type it is passed as (§3.5), so the call decides it, and one
 * nothing gives the parameters of is its whole function (../calls/function-arguments.ts).
 */
export function functionsAccepted(
  context: BodyContext,
  named: NamedFunctions,
): Accepts | undefined {
  const lone = loneFunction(context, named, undefined);
  if (lone !== undefined && hasOwnType(lone)) {
    return undefined;
  }
  return (expected, isOpen) => {
    const shape = expectedFunction(expected);
    if (shape === undefined) {
      return false;
    }
    const isFinding =
      shape.pack !== undefined ||
      shape.parameters.some(({ type }) => holesIn(type, isOpen).size > 0);
    return isFinding
      ? takesCount(context, named, shape)
      : fittedValue(context, named, shape, isOpen) !== undefined;
  };
}

/**
 * Whether `application`, of a lone function, is one function type of its own: none of its
 * parameters may be left out, nor any of its type parameters still be open.
 */
function hasOwnType({ signature, inference }: Application): boolean {
  return (
    signature.parameters.every((slot) => !slot.hasDefault && slot.rest === undefined) &&
    signature.typeParameters.every((parameter) => inference.boundOf(parameter) !== undefined)
  );
}

/** Whether one of the functions `named` means takes as many parameters as `shape`, or a pack. */
function takesCount(context: BodyContext, named: NamedFunctions, shape: FunctionType): boolean {
  const candidates = takingAsync(named.candidates(shape), shape);
  if (shape.pack !== undefined) {
    return candidates.length > 0;
  }
  const arguments_ = shape.parameters.map((slot) => ({
    type: undefined,
    passing: passingOf(slot.reference),
  }));
  return chooseAsValue(context.checker, candidates, arguments_, named.written).kind !== 'none';
}

/**
 * The application of the one function `named` means where `shape` is expected, whatever its
 * parameters are: its one candidate, when that isn't generic; or, given type arguments, the one
 * candidate they suit, as they would a call's (§3.5).
 */
function loneFunction(
  context: BodyContext,
  named: NamedFunctions,
  shape: FunctionType | undefined,
): Application | undefined {
  const candidates = named.candidates(shape);
  if (named.written === undefined && candidates.length > 1) {
    return undefined;
  }
  const [only, ...others] = candidates.flatMap((candidate) => {
    const choice = ownChoice(context, candidate, named);
    return choice.kind === 'chosen' ? [choice.application] : [];
  });
  return others.length === 0 ? only : undefined;
}

/**
 * How `candidate` takes its own parameters given the type arguments written after `named`
 * (`ownArguments`): type arguments it can't take are refused as a call's are (§3.5); else it takes
 * them only when they and the defaults give every type parameter, a pack's included, since only
 * an expected type instantiates a generic function further; with none written, only a non-generic
 * one takes them.
 */
export function ownChoice(
  context: BodyContext,
  candidate: Candidate,
  { written }: NamedFunctions,
): Choice {
  const { checker } = context;
  const { declaration, requirement } = candidate;
  const signature = signatureOf(checker, declaration, requirement?.substitution);
  const counted = typeArgumentsInapplicability(signature, written);
  if (counted !== undefined) {
    return { kind: 'none', reasons: [counted] };
  }
  const given = writtenFor(signature, written);
  const isOpen = (parameter: TypeParameter) =>
    given === undefined || (!given.has(parameter) && parameter.defaultType === undefined);
  if (signature.typeParameters.some(isOpen)) {
    return { kind: 'none', reasons: [] };
  }
  const arguments_ = signature.parameters.flatMap((slot) =>
    ownArguments(slot, given, checker.typeRules),
  );
  return chooseAsValue(checker, [candidate], arguments_, written);
}

/**
 * The arguments that pass `slot` its own type: as declared, with no type arguments `written`; with
 * them, an argument whose type the instantiation decides, which fits any type, as counting
 * parameters takes them (`takesCount`), but for a pack's rest, which they write: a tuple's items,
 * one by one, or another pack's value, spread (§3.5).
 */
function ownArguments(
  slot: SignatureSlot,
  written: Substitution | undefined,
  rules: TypeRules,
): readonly CallArgument[] {
  const passing = passingOf(slot.reference);
  if (written === undefined) {
    return [{ type: slot.type, passing }];
  }
  if (slot.rest?.kind !== 'pack') {
    return [{ type: undefined, passing }];
  }
  const pack = substitute(slot.type, written, rules);
  const items = tupleElements(pack);
  return items === undefined
    ? [{ type: pack, passing, isSpread: true }]
    : items.map((item) => ({ type: item, passing }));
}

/**
 * The function `named` means that takes `shape`'s parameters exactly, as a call passing them would
 * choose it; none for a shape ending in a pack, whose parameters are known only once a function
 * is chosen (§3.5).
 */
function chosenFor(
  context: BodyContext,
  named: NamedFunctions,
  shape: FunctionType,
): Application | undefined {
  if (shape.pack !== undefined) {
    return undefined;
  }
  const arguments_ = shape.parameters.map((slot) => ({
    type: slot.type,
    passing: passingOf(slot.reference),
    exact: true,
  }));
  const candidates = takingAsync(named.candidates(shape), shape);
  const choice = chooseAsValue(context.checker, candidates, arguments_, named.written);
  return choice.kind === 'chosen' ? choice.application : undefined;
}

/**
 * `candidates` a value of `shape` may be: an async function only where `shape` is async (§3.14).
 */
function takingAsync(candidates: readonly Candidate[], shape: FunctionType): readonly Candidate[] {
  return shape.isAsync ? candidates : candidates.filter(({ declaration }) => !declaration.isAsync);
}

function passingOf(reference: boolean): Passing {
  return reference ? 'reference' : 'value';
}
