/**
 * A checked body read through a substitution (§3.5): a body is checked once, generically, so what
 * runs for one instantiation reads it with every type it records substituted, the type arguments
 * of the field defaults it runs among them. Lowering reads a function instance's body this way,
 * and compile time a field's default for the literal running it (rules/computation.ts).
 */

import type { CheckedBody } from '../check.ts';
import { type Substitution, substitute, substituteFunction } from './type.ts';

/** `body` as one instantiation sees it: every type it records substituted by `substitution`. */
export function instantiatedBody(body: CheckedBody, substitution: Substitution): CheckedBody {
  const concrete = (type: Parameters<typeof substitute>[0]) => substitute(type, substitution);
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
            captures: checked.captures.map((captured) => ({
              ...captured,
              type: concrete(captured.type),
            })),
          };
    },
    targetsOf: (declaration) =>
      body.targetsOf(declaration).map((binding) => ({ ...binding, type: concrete(binding.type) })),
    assignedOf: (assignment) =>
      body.assignedOf(assignment).map((part) => ({ ...part, type: concrete(part.type) })),
    chainOf: (link) => {
      const chained = body.chainOf(link);
      return chained === undefined ? undefined : { ...chained, base: concrete(chained.base) };
    },
    patternOf: (pattern) => {
      const checked = body.patternOf(pattern);
      return {
        ...checked,
        bindings: checked.bindings.map((binding) => ({ ...binding, type: concrete(binding.type) })),
      };
    },
    sourcesOf: (literal) =>
      body.sourcesOf(literal)?.map((source) =>
        source.kind === 'default'
          ? {
              ...source,
              call: { ...source.call, typeArguments: source.call.typeArguments.map(concrete) },
            }
          : source,
      ),
    result: concrete(body.result),
  };
}
