/**
 * The types written type nodes resolve to (types/written/), each an entry of its own, so a node is
 * resolved once per revision, and a later revision takes it over where what it read answers alike.
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import type { ModuleId } from '../../../program/program.ts';
import type { TypeNode } from '../../../syntax/types/index.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import { sameTypeSpelled } from '../../types/parts/type-parts.ts';
import type { Type } from '../../types/type/index.ts';
import { resolveTypeNode } from '../../types/written/resolve-type.ts';

/** Each written type node's type, by the module it is written in. */
export type ResolvedTypes = EntryTable<CheckerNote, TypeNode, Type, ModuleId>;

/** The table of the types `checker`'s written type nodes resolve to. */
export function resolvedTypesOf(checker: CheckerContext): ResolvedTypes {
  return checker.entries.table({
    name: 'resolved types',
    compute: (node, module) => resolveTypeNode(checker, module, node),
    equal: sameTypeSpelled,
  });
}
