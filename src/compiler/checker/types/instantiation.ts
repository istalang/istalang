/**
 * A checked body read through a substitution (§3.5): a body is checked once, generically, so what
 * runs for one instantiation reads it with every type it records substituted. The calls it records
 * stay as checked: closing one takes the instantiation's witnesses too, which its reader has, so
 * the reader closes it (lowering/instances.ts `closeCall`, rules/computation.ts for a default's).
 * Lowering reads a function instance's body this way, and compile time a field's default for the
 * literal running it.
 */

import type { CheckedBody } from '../check.ts';
import type { Fit } from './fit.ts';
import { type Substitution, substitute, substituteAny, substituteFunction } from './type.ts';

/** `body` as one instantiation sees it: every type it records substituted by `substitution`. */
export function instantiatedBody(body: CheckedBody, substitution: Substitution): CheckedBody {
  const concrete = (type: Parameters<typeof substitute>[0]) => substitute(type, substitution);
  const concreteFit = (fit: Fit): Fit =>
    fit.conversion.kind === 'any'
      ? { ...fit, conversion: { kind: 'any', to: substituteAny(fit.conversion.to, substitution) } }
      : fit;
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
    patternOf: (pattern) => {
      const checked = body.patternOf(pattern);
      return {
        tests: checked.tests.map((test) =>
          test.kind === 'downcast'
            ? { ...test, from: substituteAny(test.from, substitution), to: concrete(test.to) }
            : test,
        ),
        bindings: checked.bindings.map((binding) => ({ ...binding, type: concrete(binding.type) })),
      };
    },
    result: concrete(body.result),
  };
}
