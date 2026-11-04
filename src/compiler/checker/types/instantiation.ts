/**
 * A checked body read through a substitution (§3.5): a body is checked once, generically, so what
 * runs for one instantiation reads it with every type it records substituted. The calls it records
 * stay as checked: closing one takes the instantiation's witnesses too, which its reader has, so
 * the reader closes it (lowering/instances.ts `closeCall`, rules/computation.ts for a default's).
 * Lowering reads a function instance's body this way, and compile time a field's default for the
 * literal running it.
 */

import type { CheckedBody, Checker } from '../check.ts';
import { type FieldRead, requiredFieldRead } from '../checked-field.ts';
import type { CheckedPattern, PartStep, PatternTest } from '../checked-pattern.ts';
import type { Fit } from './fit.ts';
import { sameType } from './identity.ts';
import { type Substitution, substitute, substituteAny, substituteKept } from './substitution.ts';
import type { FieldMember, Type } from './type.ts';
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
  checker: Pick<Checker, 'fieldsOf'>,
): CheckedBody {
  const concrete = (type: Type) => substitute(type, substitution);
  const concreteFit = (fit: Fit) => substitutedFit(fit, substitution);
  const concreteField = (field: FieldMember) => ({ ...field, type: concrete(field.type) });
  const concreteRead = (read: FieldRead): FieldRead =>
    read.kind === 'position' ? read : requiredFieldRead(checker, concrete(read.on), read.required);
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
      body.targetsOf(owner).map((binding) => ({ ...binding, type: concrete(binding.type) })),
    assignedOf: (assignment) =>
      body
        .assignedOf(assignment)
        .map((part) => ({ ...part, type: concrete(part.type), fit: concreteFit(part.fit) })),
    inCell: body.inCell,
    functionOf: (node) =>
      mapDefined(body.functionOf(node), (checked) => ({
        type: substituteKept(checked.type, substitution),
        parameters: checked.parameters.map((parameter) => ({
          ...parameter,
          type: concrete(parameter.type),
        })),
        captures: checked.captures.map((captured) => ({
          ...captured,
          type: concrete(captured.type),
        })),
      })),
    sourcesOf: body.sourcesOf,
    literalFieldsOf: (literal) =>
      mapDefined(body.literalFieldsOf(literal), (fields) => fields.map(concreteField)),
    patternOf: (pattern) =>
      mapDefined(body.patternOf(pattern), (checked) => instantiatedPattern(checked, substitution)),
    chainOf: (link) =>
      mapDefined(body.chainOf(link), (chained) => ({
        base: concrete(chained.base),
        carried: concrete(chained.carried),
      })),
    fieldReadOf: (access) => mapDefined(body.fieldReadOf(access), concreteRead),
    declaredTypeOf: (name) => mapDefined(body.declaredTypeOf(name), concrete),
    namedFieldOf: (name) => mapDefined(body.namedFieldOf(name), concreteField),
    chosenVariantOf: body.chosenVariantOf,
    candidatesAt: body.candidatesAt,
    labels: body.labels,
    result: concrete(body.result),
  };
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
function instantiatedPattern(checked: CheckedPattern, substitution: Substitution): CheckedPattern {
  const concrete = (type: Type) => substitute(type, substitution);
  const path = (steps: readonly PartStep[]) =>
    steps.map((step) => instantiatedStep(step, substitution));
  const instantiatedTest = (patternTest: PatternTest): PatternTest => {
    switch (patternTest.kind) {
      case 'downcast':
        return {
          ...patternTest,
          path: path(patternTest.path),
          from: substituteAny(patternTest.from, substitution),
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
            instantiatedPattern(each, substitution),
          ),
        };
      case 'variant':
      case 'equal':
      case 'compare':
        return { ...patternTest, path: path(patternTest.path) };
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
function instantiatedStep(step: PartStep, substitution: Substitution): PartStep {
  if (typeof step === 'number') {
    return step;
  }
  switch (step.kind) {
    case 'member':
      return { ...step, union: substitute(step.union, substitution) };
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

/**
 * `fit` as one instantiation makes it: the type a conversion converts into, substituted. A union
 * the value goes into may collapse into one type (§3.5): a value that went in as a member then is
 * a value of that type already, its own or a literal of it, which is its base's value; one that
 * went in member by member was a union of that type's literals, or that type, taken as its base.
 */
function substitutedFit({ conversion, into }: Fit, substitution: Substitution): Fit {
  const substituted = substitutedConversion(conversion, substitution);
  if (into === undefined) {
    return { conversion: substituted };
  }
  const union = substitute(into.union, substitution);
  const member = into.member === undefined ? undefined : substitute(into.member, substitution);
  if (union.kind === 'union') {
    return { conversion: substituted, into: { union, member } };
  }
  return { conversion: member === undefined ? { kind: 'base' } : substituted };
}

function substitutedConversion(conversion: Fit['conversion'], substitution: Substitution) {
  switch (conversion.kind) {
    case 'any':
      return { kind: 'any', to: substituteAny(conversion.to, substitution) } as const;
    case 'shape':
      return { kind: 'shape', to: substituteKept(conversion.to, substitution) } as const;
    default:
      return conversion;
  }
}
