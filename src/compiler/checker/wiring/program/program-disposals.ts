/**
 * The checker's disposal queries over its entries (rules/disposal/disposal.ts), each kept per type:
 * a type's disposal, since finding a declared `dispose` chooses among candidates, and the kinds of
 * the `dispose` functions that may take it, read from their heads.
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import { sameItems } from '../../../../foundation/structures/equality.ts';
import type { Disposal } from '../../check.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import { disposalOf, disposeKindsOf } from '../../rules/disposal/disposal.ts';
import { sameTypeSpelled, unaliased } from '../../types/parts/type-parts.ts';
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
  const disposeKinds = checker.entries.table({
    name: 'dispose kinds',
    compute: (_key: string, type: NominalType) => disposeKindsOf(checker, type),
    equal: sameItems(sameTypeSpelled),
  });
  const keyed =
    <Value>(table: EntryTable<CheckerNote, string, Value, NominalType>) =>
    (type: NominalType): Value => {
      const unspelled = unaliased(type);
      return table.get(checker.typeKeys.spelledKey(unspelled), unspelled);
    };
  return { disposalOf: keyed(disposals), disposeKindsOf: keyed(disposeKinds) };
}

/** Whether two disposals are alike: a declared `dispose`'s by its call, the others by kind. */
function sameDisposal(first: Disposal, second: Disposal): boolean {
  return first === second || (first.kind !== 'function' && first.kind === second.kind);
}
