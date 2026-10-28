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

/**
 * `body` as one instantiation sees it: every type it records substituted by `substitution`, and
 * each field read through a type parameter resolved for the type it stands for.
 */
export function instantiatedBody(
  body: CheckedBody,
  substitution: Substitution,
  checker: Pick<Checker, 'fieldsOf'>,
): CheckedBody {
  const concrete = (type: Parameters<typeof substitute>[0]) => substitute(type, substitution);
  const concreteFit = (fit: Fit): Fit =>
    fit.conversion.kind === 'any'
      ? { ...fit, conversion: { kind: 'any', to: substituteAny(fit.conversion.to, substitution) } }
      : fit;
  const concreteRead = (read: FieldRead): FieldRead => {
    switch (read.kind) {
      case 'position':
        return read;
      case 'dispatch':
        return { ...read, on: substituteAny(read.on, substitution) };
      case 'required':
        return requiredFieldRead(checker, concrete(read.on), read.required);
      default: {
        const unhandled: never = read;
        return unhandled;
      }
    }
  };
  return {
    ...body,
    typeOf: (expression) => concrete(body.typeOf(expression)),
    functionOf: (node) => {
      const checked = body.functionOf(node);
      return checked === undefined
        ? undefined
        : {
            ...checked,
            type: substituteFunction(checked.type, substitution),
            parameters: checked.parameters.map((parameter) => ({
              ...parameter,
              type: concrete(parameter.type),
            })),
            captures: checked.captures.map((captured) => ({
              ...captured,
              type: concrete(captured.type),
            })),
          };
    },
    targetsOf: (declaration) =>
      body.targetsOf(declaration).map((binding) => ({ ...binding, type: concrete(binding.type) })),
    assignedOf: (assignment) =>
      body
        .assignedOf(assignment)
        .map((part) => ({ ...part, type: concrete(part.type), fit: concreteFit(part.fit) })),
    fitAt: (site) => concreteFit(body.fitAt(site)),
    iterationOf: (iteration) => {
      const form = body.iterationOf(iteration);
      return form.kind === 'cursor' ? { ...form, item: concrete(form.item) } : form;
    },
    chainOf: (link) => {
      const chained = body.chainOf(link);
      return chained === undefined ? undefined : { ...chained, base: concrete(chained.base) };
    },
    patternOf: (pattern) => instantiatedPattern(body.patternOf(pattern), substitution),
    fieldReadOf: (access) => concreteRead(body.fieldReadOf(access)),
    result: concrete(body.result),
  };
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
