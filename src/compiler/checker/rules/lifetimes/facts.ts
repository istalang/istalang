/**
 * What the lifetime rule reads of types (design.md §5.1, §5.5), kept as entries per type, so every
 * function's analysis asks each once: whether a type's values may reach a disposable, which handles
 * they may hold, surely or as an instantiation decides; a captured `let`'s cell; and a struct's
 * fields' names, in the order its literals make them.
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import type { Type } from '../../types/type/index.ts';
import type { AnalysisContext } from './analysis/body.ts';
import { ReachPairs } from './analysis/reach-pairs.ts';
import {
  type HandleReach,
  handleReachOf,
  type Relevance,
  relevanceOf,
  sameHandleReach,
} from './type-reach.ts';

/**
 * What the analysis reads of types, kept as entries per type: whether its values may reach a
 * disposable, and which handles they may hold; and its cell, and its fields' names.
 */
export function typeFactsOf(checker: CheckerContext): AnalysisContext['facts'] {
  const relevance: EntryTable<CheckerNote, string, Relevance, Type> = checker.entries.table({
    name: 'lifetime relevance',
    compute: (_key: string, type: Type) => relevanceOf(checker, type),
  });
  const handles: EntryTable<CheckerNote, string, HandleReach, Type> = checker.entries.table({
    name: 'lifetime handles',
    compute: (_key: string, type: Type) => handleReachOf(checker, type),
    equal: sameHandleReach,
  });
  const knownHandles: EntryTable<CheckerNote, string, HandleReach, Type> = checker.entries.table({
    name: 'lifetime known handles',
    compute: (_key: string, type: Type) => handleReachOf(checker, type, 'nothing'),
    equal: sameHandleReach,
  });
  const typeKey = (type: Type) => checker.typeKeys.typeKey(type);
  return {
    relevanceOf: (type) => relevance.get(typeKey(type), type),
    reachOf: (type) => handles.get(typeKey(type), type),
    knownReachOf: (type) => knownHandles.get(typeKey(type), type),
    cellOf: (type) => checker.cellOf(type),
    keyOf: typeKey,
    pairs: new ReachPairs(),
  };
}
