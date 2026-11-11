/**
 * The checker's disposal queries over its entries (rules/disposal/disposal.ts), each kept per type:
 * the `dispose` candidates that may take it, found once, since finding them looks up every
 * `dispose` its call could mean; its disposal, chosen among them; and their kinds, read from their
 * heads.
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import { sameItems } from '../../../../foundation/structures/equality.ts';
import type { Disposal } from '../../check.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import {
  type DisposeCandidates,
  disposalOf,
  disposeCandidates,
  disposeKindsOf,
} from '../../rules/disposal/disposal.ts';
import { sameTypeSpelled, unaliased } from '../../types/parts/type-parts.ts';
import type { NominalType } from '../../types/type/index.ts';

/** The checker's disposal queries over `checker`'s entries. */
export function programDisposals(
  checker: CheckerContext,
): Pick<CheckerContext, 'disposalOf' | 'disposeKindsOf'> {
  const candidates = checker.entries.table({
    name: 'dispose candidates',
    compute: (_key: string, type: NominalType) => disposeCandidates(checker, type),
    equal: sameCandidates,
  });
  const disposals = checker.entries.table({
    name: 'disposals',
    compute: (key: string, type: NominalType) =>
      disposalOf(checker, type, candidates.get(key, type)),
    equal: sameDisposal,
  });
  const disposeKinds = checker.entries.table({
    name: 'dispose kinds',
    compute: (key: string, type: NominalType) =>
      disposeKindsOf(checker, type, candidates.get(key, type)),
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

/** Whether two finds of a type's `dispose` candidates found the same functions, the same way. */
function sameCandidates(
  first: DisposeCandidates | undefined,
  second: DisposeCandidates | undefined,
): boolean {
  return (
    first === second ||
    (first !== undefined &&
      second !== undefined &&
      first.runtime === second.runtime &&
      sameItems<DisposeCandidates['candidates'][number]>(
        (one, other) => one.declaration === other.declaration,
      )(first.candidates, second.candidates))
  );
}

/** Whether two disposals are alike: a declared `dispose`'s by its call, the others by kind. */
function sameDisposal(first: Disposal, second: Disposal): boolean {
  return first === second || (first.kind !== 'function' && first.kind === second.kind);
}
