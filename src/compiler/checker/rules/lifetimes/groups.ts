/**
 * The recursive groups of the call graph (lifetimes.ts): functions calling each other are summed
 * up together, from summaries that do nothing, until none changes.
 *
 * A function's group is found in the graph it reaches, which holds every member, so a check reads
 * no body its functions don't reach. Each group is named by its first member in declaration
 * order, module by module, so every member finds it alike and shares its entry.
 */

import { stronglyConnected } from '../../../../foundation/structures/strongly-connected.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import { type Summary, sameSummary } from './summary.ts';

/** A call between two functions with bodies: an edge of the call graph. */
export interface Call {
  readonly from: FunctionDeclaration;
  readonly to: FunctionDeclaration;
}

/**
 * The recursive group of `declaration` in the call graph `edges` it reaches: its members ordered
 * by where they are declared (`position`), or `declaration` alone.
 */
export function groupOf(
  edges: readonly Call[],
  declaration: FunctionDeclaration,
  position: (declaration: FunctionDeclaration) => readonly [string, number],
): readonly FunctionDeclaration[] {
  const componentOf = stronglyConnected(edges);
  const component = componentOf(declaration);
  const members = new Set<FunctionDeclaration>([declaration]);
  for (const { from, to } of edges) {
    if (
      component !== undefined &&
      componentOf(from) === component &&
      componentOf(to) === component
    ) {
      members.add(from).add(to);
    }
  }
  const before = (first: FunctionDeclaration, second: FunctionDeclaration) => {
    const [firstModule, firstAt] = position(first);
    const [secondModule, secondAt] = position(second);
    return firstModule.localeCompare(secondModule) || firstAt - secondAt;
  };
  return [...members].sort(before);
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
