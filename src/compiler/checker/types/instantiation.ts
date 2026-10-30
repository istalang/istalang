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
import type { CheckedPattern, PatternTest } from '../checked-pattern.ts';
import type { Fit } from './fit.ts';
import {
  type Substitution,
  substitute,
  substituteAny,
  substituteFunction,
} from './substitution.ts';
import type { FieldMember, Type } from './type.ts';

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
  const concreteFit = (fit: Fit): Fit =>
    fit.conversion.kind === 'any'
      ? { ...fit, conversion: { kind: 'any', to: substituteAny(fit.conversion.to, substitution) } }
      : fit;
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
        type: substituteFunction(checked.type, substitution),
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
      mapDefined(body.chainOf(link), (chained) => ({ ...chained, base: concrete(chained.base) })),
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
 * kind is listed, so a kind that comes to carry a type can't pass through unsubstituted.
 */
function instantiatedPattern(checked: CheckedPattern, substitution: Substitution): CheckedPattern {
  const instantiatedTest = (patternTest: PatternTest): PatternTest => {
    switch (patternTest.kind) {
      case 'downcast':
        return {
          ...patternTest,
          from: substituteAny(patternTest.from, substitution),
          to: substitute(patternTest.to, substitution),
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
        return patternTest;
      default: {
        const unhandled: never = patternTest;
        return unhandled;
      }
    }
  };
  return {
    tests: checked.tests.map(instantiatedTest),
    bindings: checked.bindings.map((binding) => ({
      ...binding,
      type: substitute(binding.type, substitution),
    })),
  };
}
