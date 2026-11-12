/**
 * The recursive groups of the call graph (lifetimes.ts): functions calling each other are summed
 * up together, from summaries that do nothing, until none changes.
 *
 * Each group is named by its first member in declaration order, module by module, so every
 * module's exploration of the graph names it alike and shares its entry.
 */

import { sameItems } from '../../../../foundation/structures/equality.ts';
import { stronglyConnected } from '../../../../foundation/structures/strongly-connected.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import { type Summary, sameSummary } from './summary.ts';

/** Each member of a recursive group, and the group, its members in order. */
export type Groups = ReadonlyMap<FunctionDeclaration, readonly FunctionDeclaration[]>;

/** A call between two functions with bodies: an edge of the call graph. */
export interface Call {
  readonly from: FunctionDeclaration;
  readonly to: FunctionDeclaration;
}

/**
 * The recursive groups of the call graph `edges`: each member's group, ordered by where its
 * members are declared (`position`).
 */
export function groupsOf(
  edges: readonly Call[],
  position: (declaration: FunctionDeclaration) => readonly [string, number],
): Groups {
  const componentOf = stronglyConnected(edges);
  const members = new Map<FunctionDeclaration, Set<FunctionDeclaration>>();
  for (const { from, to } of edges) {
    const component = componentOf(from);
    if (component !== undefined && component === componentOf(to)) {
      const group = members.get(component) ?? new Set();
      group.add(from).add(to);
      members.set(component, group);
    }
  }
  const before = (first: FunctionDeclaration, second: FunctionDeclaration) => {
    const [firstModule, firstAt] = position(first);
    const [secondModule, secondAt] = position(second);
    return firstModule.localeCompare(secondModule) || firstAt - secondAt;
  };
  const groups = new Map<FunctionDeclaration, readonly FunctionDeclaration[]>();
  for (const group of members.values()) {
    const ordered = [...group].sort(before);
    for (const each of ordered) {
      groups.set(each, ordered);
    }
  }
  return groups;
}

export function sameGroupSummaries(
  first: ReadonlyMap<FunctionDeclaration, Summary>,
  second: ReadonlyMap<FunctionDeclaration, Summary>,
): boolean {
  return [...first].every(([member, summary]) => {
    const other = second.get(member);
    return other !== undefined && sameSummary(summary, other);
  });
}

export function sameGroups(first: Groups, second: Groups): boolean {
  if (first.size !== second.size) {
    return false;
  }
  for (const [declaration, members] of first) {
    const other = second.get(declaration);
    if (other === undefined || !sameItems()(members, other)) {
      return false;
    }
  }
  return true;
}
