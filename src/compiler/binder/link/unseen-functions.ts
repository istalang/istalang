/**
 * The function sets of called names no scope defines (§3.13): a set with no overloads of its own,
 * which argument-dependent lookup fills, and which the checker reports when it finds none.
 *
 * Per module, the set each name denotes is kept while the module's items are, as entities are kept
 * with their nodes (../entities.ts), so an edit inside a body keeps it, and everything the checker
 * took over about it.
 */

import { memo, SequenceMemo } from '../../../foundation/structures/memo.ts';
import type { ModuleId } from '../../program/program.ts';
import type { Module } from '../../syntax/declarations/index.ts';
import type { FunctionsEntity } from '../entities.ts';

const unseenFunctions = new SequenceMemo<Module['items'][number], Map<string, FunctionsEntity>>();

/** The empty function set `name`, called in module `id` of `items` and declared by no scope, denotes. */
export function unseenFunction(
  id: ModuleId,
  items: Module['items'],
  name: string,
): FunctionsEntity {
  const ofModule = unseenFunctions.get(items, () => new Map<string, FunctionsEntity>());
  return memo(
    ofModule,
    name,
    () => ({ kind: 'functions', module: id, name, overloads: [] }) as const,
  );
}
