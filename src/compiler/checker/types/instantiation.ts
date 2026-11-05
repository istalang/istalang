/**
 * A checked body read through a substitution (§3.5): a body is checked once, generically, so what
 * runs for one instantiation reads it with every type it records substituted. The calls it records
 * stay as checked: closing one takes the instantiation's witnesses too, which its reader has, so
 * the reader closes it (lowering/closed-calls.ts `closeCall`, rules/computation.ts for a default's).
 * Lowering reads a function instance's body this way, and compile time a field's default for the
 * literal running it.
 */

import type { AssignedPart, CheckedBody, CheckedFunction, Checker, FieldPass } from '../check.ts';
import { type FieldRead, instantiatedRead } from '../checked-field.ts';
import type {
  CheckedPattern,
  PartStep,
  PatternTest,
  StructStep,
  TargetBinding,
  TargetStep,
} from '../checked-pattern.ts';
import type { Fit } from './fit.ts';
import { sameType } from './identity.ts';
import { type Substitution, substitute, substituteAny, substituteKept } from './substitution.ts';
import type { FieldMember, Type } from './type.ts';
import type { TypeRules } from './type-rules.ts';
import { membersOf } from './unions.ts';

/**
 * `body` as one instantiation sees it: every type it records substituted by `substitution`, and
 * each field read through a type parameter resolved for the type it stands for. Every table is
 * listed, substituted or kept as checked, so a table added to CheckedBody fails to typecheck here
 * until it says how an instantiation reads it.
 */
export function instantiatedBody(
  body: CheckedBody,
  substitution: Substitution,
  checker: Pick<Checker, 'fieldsOf' | 'typeRules'>,
): CheckedBody {
  const concrete = (type: Type) => substitute(type, substitution, checker.typeRules);
  const concreteFit = (fit: Fit) => substitutedFit(fit, substitution, checker.typeRules);
  const concreteField = (field: FieldMember) => ({ ...field, type: concrete(field.type) });
  const concreteRead = (read: FieldRead): FieldRead => instantiatedRead(checker, read, concrete);
  return {
    typeOf: (expression) => mapDefined(body.typeOf(expression), concrete),
    expectedOf: (site) => mapDefined(body.expectedOf(site), concrete),
    resolved: body.resolved,
    valueCalls: body.valueCalls,
    madeCalls: body.madeCalls,
    implicitCallOf: body.implicitCallOf,
    collectionFormOf: body.collectionFormOf,
    iterationOf: (iteration) => {
      const form = body.iterationOf(iteration);
      return form.kind === 'cursor' ? { ...form, item: concrete(form.item) } : form;
    },
    fitAt: (site) => concreteFit(body.fitAt(site)),
    targetsOf: (owner) =>
      body.targetsOf(owner).map((binding) => instantiatedTarget(binding, substitution, checker)),
    assignedOf: (assignment) =>
      body.assignedOf(assignment).map((part) => instantiatedPart(part, substitution, checker)),
    inCell: body.inCell,
    functionOf: (node) =>
      mapDefined(body.functionOf(node), (checked) =>
        instantiatedFunction(checked, substitution, checker.typeRules),
      ),
    sourcesOf: body.sourcesOf,
    literalFieldsOf: (literal) =>
      mapDefined(body.literalFieldsOf(literal), (fields) => fields.map(concreteField)),
    patternOf: (pattern) =>
      mapDefined(body.patternOf(pattern), (checked) =>
        instantiatedPattern(checked, substitution, checker.typeRules),
      ),
    chainOf: (link) =>
      mapDefined(body.chainOf(link), (chained) => ({
        base: concrete(chained.base),
        carried: concrete(chained.carried),
      })),
    fieldReadOf: (access) => mapDefined(body.fieldReadOf(access), concreteRead),
    declaredTypeOf: (name) => mapDefined(body.declaredTypeOf(name), concrete),
    namedFieldOf: (name) => mapDefined(body.namedFieldOf(name), concreteField),
    keyOwnerOf: (literal) => mapDefined(body.keyOwnerOf(literal), concrete),
    builtLiteralOf: body.builtLiteralOf,
    chosenVariantOf: body.chosenVariantOf,
    candidatesAt: body.candidatesAt,
    labels: body.labels,
    passesOf: (header) => instantiatedPasses(body.passesOf(header), substitution, checker),
    isRuledOut: body.isRuledOut,
    stopsAt: body.stopsAt,
    decidedOf: body.decidedOf,
    result: concrete(body.result),
  };
}

/** A part an assignment writes, its path, type and fit substituted. */
function instantiatedPart(
  part: AssignedPart,
  substitution: Substitution,
  { typeRules: rules }: Pick<Checker, 'typeRules'>,
): AssignedPart {
  return {
    ...part,
    path: instantiatedTargetPath(part.path, substitution, rules),
    type: substitute(part.type, substitution, rules),
    fit: part.fit === 'intoKeyedField' ? part.fit : substitutedFit(part.fit, substitution, rules),
  };
}

/** A lambda or local function of the body with every type it records substituted. */
function instantiatedFunction(
  checked: CheckedFunction,
  substitution: Substitution,
  rules: TypeRules,
): CheckedFunction {
  const concrete = (type: Type) => substitute(type, substitution, rules);
  return {
    type: substituteKept(checked.type, substitution, rules),
    parameters: checked.parameters.map((parameter) => ({
      ...parameter,
      type: concrete(parameter.type),
    })),
    captures: checked.captures.map((captured) => ({ ...captured, type: concrete(captured.type) })),
  };
}

/** A field loop's passes as one instantiation reads them: their types and bodies substituted. */
function instantiatedPasses(
  passes: readonly FieldPass[],
  substitution: Substitution,
  checker: Pick<Checker, 'fieldsOf' | 'typeRules'>,
): readonly FieldPass[] {
  return passes.map(({ visits, key, value, body }) => ({
    visits,
    key: substitute(key, substitution, checker.typeRules),
    value: substitute(value, substitution, checker.typeRules),
    body: instantiatedBody(body, substitution, checker),
  }));
}

/** What a target binds, as one instantiation sees it: its type and its path's types substituted. */
function instantiatedTarget(
  binding: TargetBinding,
  substitution: Substitution,
  checker: Pick<Checker, 'typeRules'>,
): TargetBinding {
  const rules = checker.typeRules;
  return {
    ...binding,
    type: substitute(binding.type, substitution, rules),
    path: instantiatedTargetPath(binding.path, substitution, rules),
  };
}

/** A target's or an assignment's path as one instantiation sees it: its struct steps' types substituted. */
function instantiatedTargetPath(
  path: readonly TargetStep[],
  substitution: Substitution,
  rules: TypeRules,
): readonly TargetStep[] {
  return path.map((step) =>
    typeof step === 'number' ? step : instantiatedStructStep(step, substitution, rules),
  );
}

/** `f(value)`, or undefined for an undefined value: a table's answer, read through `f`. */
function mapDefined<T, R>(value: T | undefined, f: (defined: T) => R): R | undefined {
  return value === undefined ? undefined : f(value);
}

/**
 * `checked` with every type it records substituted, in its or-patterns' alternatives too. Each test
 * and step kind is listed, so a kind that comes to carry a type can't pass through unsubstituted.
 *
 * A union a member test tests may collapse (§3.5): `T | Int` with `T = Int` is `Int`. Its value is
 * then the member's own value, with no variant around it: the `member` step into it carries the
 * union, substituted here, so whoever reads the path sees the collapse, and a name narrowed from
 * it reads the value as it is.
 */
function instantiatedPattern(
  checked: CheckedPattern,
  substitution: Substitution,
  rules: TypeRules,
): CheckedPattern {
  const concrete = (type: Type) => substitute(type, substitution, rules);
  const path = (steps: readonly PartStep[]) =>
    steps.map((step) => instantiatedStep(step, substitution, rules));
  const instantiatedTest = (patternTest: PatternTest): PatternTest => {
    switch (patternTest.kind) {
      case 'downcast':
        return {
          ...patternTest,
          path: path(patternTest.path),
          from: substituteAny(patternTest.from, substitution, rules),
          to: concrete(patternTest.to),
        };
      case 'member':
        return {
          ...patternTest,
          path: path(patternTest.path),
          union: concrete(patternTest.union),
          members: patternTest.members.flatMap((member) => membersOf(concrete(member))),
        };
      case 'or':
        return {
          ...patternTest,
          alternatives: patternTest.alternatives.map((each) =>
            instantiatedPattern(each, substitution, rules),
          ),
        };
      case 'variant':
      case 'equal':
      case 'compare':
        return { ...patternTest, path: path(patternTest.path) };
      case 'never':
        return patternTest;
      default: {
        const unhandled: never = patternTest;
        return unhandled;
      }
    }
  };
  return {
    tests: checked.tests.map(instantiatedTest),
    bindings: checked.bindings.map(({ narrowedFrom, ...binding }) => {
      const type = concrete(binding.type);
      const from = narrowedFrom === undefined ? undefined : concrete(narrowedFrom);
      return {
        ...binding,
        path: path(binding.path),
        type,
        narrowedFrom: from === undefined || sameType(from, type) ? undefined : from,
      };
    }),
  };
}

/** `step` with the type it carries substituted. */
function instantiatedStep(step: PartStep, substitution: Substitution, rules: TypeRules): PartStep {
  if (typeof step === 'number') {
    return step;
  }
  switch (step.kind) {
    case 'member':
      return {
        kind: 'member',
        union: substitute(step.union, substitution, rules),
        member: substitute(step.member, substitution, rules),
      };
    case 'field':
    case 'fieldRest':
      return instantiatedStructStep(step, substitution, rules);
    case 'downcast':
    case 'length':
    case 'item':
    case 'rest':
      return step;
    default: {
      const unhandled: never = step;
      return unhandled;
    }
  }
}

/** A struct step with the types it carries substituted: an instantiation decides what they are. */
function instantiatedStructStep(
  step: StructStep,
  substitution: Substitution,
  rules: TypeRules,
): StructStep {
  const concrete = (type: Type) => substitute(type, substitution, rules);
  return step.kind === 'field'
    ? { ...step, of: concrete(step.of) }
    : { kind: 'fieldRest', from: concrete(step.from), to: concrete(step.to) };
}

/**
 * `fit` as one instantiation makes it: the type a conversion converts into, substituted. A union
 * the value goes into may collapse into one type (§3.5): a value that went in as a member then is
 * a value of that type already, its own or a literal of it, which is its base's value; one that
 * went in member by member was a union of that type's literals, or that type, taken as its base.
 * A union collapsing into an `any` type took the value's type whole (§2), so the value still goes
 * into it, as lowering derives.
 */
function substitutedFit(
  { conversion, into }: Fit,
  substitution: Substitution,
  rules: TypeRules,
): Fit {
  const substituted = substitutedConversion(conversion, substitution, rules);
  if (into === undefined) {
    return { conversion: substituted };
  }
  const union = substitute(into.union, substitution, rules);
  const member =
    into.member === undefined ? undefined : substitute(into.member, substitution, rules);
  if (union.kind === 'union' || union.kind === 'any') {
    return { conversion: substituted, into: { union, member } };
  }
  return { conversion: member === undefined ? { kind: 'base' } : substituted };
}

function substitutedConversion(
  conversion: Fit['conversion'],
  substitution: Substitution,
  rules: TypeRules,
) {
  switch (conversion.kind) {
    case 'any':
      return { kind: 'any', to: substituteAny(conversion.to, substitution, rules) } as const;
    case 'shape':
      return { kind: 'shape', to: substituteKept(conversion.to, substitution, rules) } as const;
    default:
      return conversion;
  }
}
