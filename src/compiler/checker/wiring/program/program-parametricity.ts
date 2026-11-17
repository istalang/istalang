/**
 * The checker's answers about sharing instances across types (rules/parametricity/), each an entry
 * of its own: which functions the program's test modules mock, whose instances are never shared,
 * and which type parameters each other function uses only opaquely. Lowering reads both: the first
 * keys the std's kept entries (lowering/tables/std-lowering.ts), the second shares instances.
 */

import type { CheckerContext } from '../../contexts/context.ts';
import { opaqueParametersQuery } from '../../rules/parametricity/opaque-parameters.ts';
import { mockedFunctionsQuery } from '../../rules/testing.ts';

/** The checker's parametricity queries over `checker`'s entries. */
export function programParametricity(
  checker: CheckerContext,
): Pick<CheckerContext, 'mockedFunctions' | 'opaqueParametersOf'> {
  const mockedFunctions = mockedFunctionsQuery(checker);
  return {
    mockedFunctions,
    opaqueParametersOf: opaqueParametersQuery(checker, mockedFunctions),
  };
}
