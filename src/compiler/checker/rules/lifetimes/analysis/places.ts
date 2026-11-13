/**
 * What a place is (flow-ir.ts `Place`), for a write into it or a call given it by `&`: the node
 * standing for its value, and what owns it (design.md §2).
 *
 * - A path crossing a handle (`x->f`, `*x`) lands in that handle's cell: in the root's own handle
 *   when the root is it, else in one the root reaches, known only as reached from the root.
 * - A path crossing none lands in the root variable's storage: a captured `let`'s cell, a
 *   reference parameter's caller's place, or a plain variable, which is no object and closes no
 *   cycle.
 * - The place's value is stood for by its root, which holds it as a part or reaches it.
 */

import type { Place } from '../../../surface/flow-ir.ts';
import type { NodeId } from '../reach-state.ts';
import type { BodyAnalysis, Holder } from './body.ts';
import type { FlowState } from './flow-state.ts';
import { readKindOf } from './nodes.ts';

/** What owns a place: a handle's or cell's object, a reference parameter, or a variable. */
export type Owner =
  | { readonly kind: 'heap'; readonly holder: Holder }
  | { readonly kind: 'value'; readonly variable: NodeId }
  | { readonly kind: 'reference'; readonly variable: NodeId };

interface PlaceTarget {
  readonly value: NodeId;
  readonly owner: Owner;
}

export function placeTarget(analysis: BodyAnalysis, state: FlowState, place: Place): PlaceTarget {
  const root = analysis.canonOf(state, place.root) ?? place.root;
  const through = place.path.findLastIndex((part) => readKindOf(part) === 'through');
  const type = analysis.nodes.typeOf(root);
  if (through >= 0 && type !== undefined) {
    return {
      value: root,
      owner: { kind: 'heap', holder: { node: root, exact: through === 0, type } },
    };
  }
  if (analysis.nodes.isCell(root)) {
    const cell = analysis.nodes.cell(root);
    const cellType = analysis.nodes.typeOf(cell);
    if (cellType !== undefined && state.reach.isLive(cell)) {
      return {
        value: root,
        owner: { kind: 'heap', holder: { node: cell, exact: true, type: cellType } },
      };
    }
  }
  if (analysis.references.has(root)) {
    return { value: root, owner: { kind: 'reference', variable: root } };
  }
  return { value: root, owner: { kind: 'value', variable: root } };
}
