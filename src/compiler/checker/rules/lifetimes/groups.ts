/**
 * The recursive groups of the call graph (lifetimes.ts): functions calling each other are summed
 * up together, from analyses that do nothing, until none changes.
 *
 * - **Its nodes are the functions running code of their own,** a body or defaults: a default may
 *   call back into its function, or into the struct whose field it is, so a group counts its calls.
 * - A function's group is found in the graph it reaches, which holds every member, so a check
 *   reads no body its functions don't reach. Each group is named by its first member in
 *   declaration order, module by module, so every member finds it alike and shares its entry.
 */

import { sameItems } from '../../../../foundation/structures/equality.ts';
import { stronglyConnected } from '../../../../foundation/structures/strongly-connected.ts';
import { isFieldsFunction } from '../../../syntax/declarations/field-defaults.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import { defaultValuesOf } from '../../../syntax/expressions/parameters.ts';
import type { Analysis } from './analysis/index.ts';
import { type DefaultsFound, noDefaults } from './declared.ts';
import { emptySummary, sameSummary } from './summary.ts';

/** A call between two functions running code of their own: an edge of the call graph. */
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

/**
 * Whether `declaration` is written with a body: neither an extern nor a fields function. Read off
 * its declaration, so an edit inside a body leaves what asks alone; a body the parser lost is
 * analysed as doing nothing, its error reported elsewhere.
 */
export function hasBody(declaration: FunctionDeclaration): boolean {
  return !(declaration.isExtern || isFieldsFunction(declaration));
}

/** Whether `declaration` runs code of its own when called: a body, or defaults it writes. */
export function hasCode(declaration: FunctionDeclaration): boolean {
  return hasBody(declaration) || defaultValuesOf(declaration.parameters).length > 0;
}

/** A function's analysis: its body's, with what its defaults find. */
export type FunctionAnalysis = Analysis & { readonly defaults: DefaultsFound };

/** What each default's value relates to, by its parameter's position. */
export type DefaultResults = DefaultsFound['results'];

/** The analyses of a recursive group's members. */
export type GroupAnalyses = ReadonlyMap<FunctionDeclaration, FunctionAnalysis>;

/** The analysis of a function doing nothing: a group's first guess for each member. */
export const doesNothing: FunctionAnalysis = {
  summary: emptySummary,
  violations: [],
  inputTypes: new Map(),
  defaults: noDefaults,
};

/** Whether two rounds of a group's analyses agree: each member's summary and its defaults'. */
export function sameGroupAnalyses(first: GroupAnalyses, second: GroupAnalyses): boolean {
  return [...first].every(([member, analysis]) => {
    const other = second.get(member);
    return (
      other !== undefined &&
      sameSummary(analysis.summary, other.summary) &&
      sameItems(sameSummary)(analysis.defaults.summaries, other.defaults.summaries)
    );
  });
}
