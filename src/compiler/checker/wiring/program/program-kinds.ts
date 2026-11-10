/**
 * The kinds the checker keeps as entries of its own (proposal 8, Rules 2–3): each function's kind,
 * and the kinds what a type's values hold are of, so each is found once per revision however many
 * signatures and calls ask, and a later revision takes it over where what it read answers alike.
 */

import type { CheckerContext } from '../../contexts/context.ts';
import { sameTypeSpelled } from '../../types/parts/type-parts.ts';
import { heldKindsOf } from '../../types/properties/value-kinds.ts';
import { functionKindOf } from '../../types/type/function-kinds.ts';

/** The checker's kind queries over `checker`'s entries. */
export function programKinds(
  checker: CheckerContext,
): Pick<CheckerContext, 'kindOf' | 'valueKindsOf'> {
  const functions = checker.entries.table({
    name: 'function kinds',
    compute: (declaration: Parameters<CheckerContext['kindOf']>[0]) =>
      functionKindOf(checker, declaration),
    equal: sameTypeSpelled,
  });
  const values = checker.entries.table({
    name: 'value kinds',
    compute: (_key: string, type: Parameters<CheckerContext['valueKindsOf']>[0]) =>
      heldKindsOf(checker, type),
    equal: (first, second) =>
      first.length === second.length &&
      first.every((kind, index) => sameTypeSpelled(kind, second[index] ?? kind)),
  });
  return {
    kindOf: (declaration) => functions.get(declaration),
    valueKindsOf: (type) => values.get(checker.typeKeys.typeKey(type), type),
  };
}
