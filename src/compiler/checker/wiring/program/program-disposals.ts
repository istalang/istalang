/**
 * The checker's disposal queries over its entries (rules/disposal/disposal.ts). A type's disposal is
 * kept per type, since finding a declared `dispose` chooses among candidates; the kinds of the
 * `dispose` functions that may take a type are read from their heads, kept by the kinds tables that
 * ask them (program-kinds.ts).
 */

import type { Disposal } from '../../check.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { disposalOf, disposeKindsOf } from '../../rules/disposal/disposal.ts';
import { unaliased } from '../../types/parts/type-parts.ts';
import type { NominalType } from '../../types/type/index.ts';

/** The checker's disposal queries over `checker`'s entries. */
export function programDisposals(
  checker: CheckerContext,
): Pick<CheckerContext, 'disposalOf' | 'disposeKindsOf'> {
  const disposals = checker.entries.table({
    name: 'disposals',
    compute: (_key: string, type: NominalType) => disposalOf(checker, type),
    equal: sameDisposal,
  });
  return {
    disposalOf: (type) => {
      const unspelled = unaliased(type);
      return disposals.get(checker.typeKeys.spelledKey(unspelled), unspelled);
    },
    disposeKindsOf: (type) => disposeKindsOf(checker, type),
  };
}

/** Whether two disposals are alike: a declared `dispose`'s by its call, the others by kind. */
function sameDisposal(first: Disposal, second: Disposal): boolean {
  return first === second || (first.kind !== 'function' && first.kind === second.kind);
}
