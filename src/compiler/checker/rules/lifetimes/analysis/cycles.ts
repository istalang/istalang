/**
 * The cycle a write closes, by types (design.md §5.3), for what decides it to read off: the type
 * deciding whether it holds a disposable, and the types of what its value reaches its holder
 * through, which decide whether an instantiation can close it at all.
 *
 * - **The surest path decides.** Each path the value may reach the holder by holds a disposable
 *   only where every value on it may reach one, so a path through a value of a type parameter's
 *   type is decided by its instantiation.
 * - **A value this body made goes by its parts,** each a path of its own: its other parts don't
 *   reach the holder, so neither their types nor what they hold decide anything.
 */

import type { Type } from '../../../types/type/index.ts';
import { decidingType } from '../escaping.ts';
import type { NodeId } from '../reach-state.ts';
import type { TypedCycle } from '../summary.ts';
import { lessRelevant, type Relevance } from '../type-reach.ts';
import type { BodyAnalysis, Holder } from './body.ts';
import type { FlowState } from './flow-state.ts';
import type { Nodes } from './nodes.ts';

/** The cycle writing `value` into `holder` closes, by types. */
export function cycleOf(
  analysis: BodyAnalysis,
  state: FlowState,
  { node: holder, type, exact }: Holder,
  value: NodeId,
): TypedCycle {
  const path = pathOf(analysis, state, holder, value);
  return {
    holder: type,
    through: path?.through ?? [type],
    kind: exact ? 'reach' : 'share',
    deciding: path === undefined ? type : decidingType(analysis.context.facts, type, path.least),
  };
}

/**
 * The least relevant type on the surest path from `value` to `holder`, and the types of what it
 * goes through: the parts of a value this body made where it has them, else the value.
 */
function pathOf(
  analysis: BodyAnalysis,
  state: FlowState,
  holder: NodeId,
  value: NodeId,
): { readonly least: Type; readonly through: readonly Type[] } | undefined {
  const { nodes } = analysis;
  const valueType = nodes.typeOf(value);
  if (valueType === undefined) {
    return undefined;
  }
  const parts = nodes
    .pathsFrom(value)
    .filter((path) => nodes.pathOf(path)?.kind === 'part' && state.reach.isLive(path));
  const closing = parts
    .filter((path) => state.reach.closes(holder, path))
    .flatMap((path) => pathOf(analysis, state, holder, path) ?? []);
  if (closing.length > 0) {
    const most = closing
      .map((path) => path.least)
      .reduce((found, each) =>
        lessRelevant(nodes.relevanceOf(found), nodes.relevanceOf(each)) ? each : found,
      );
    return {
      least: decidingType(analysis.context.facts, valueType, most),
      through: closing.flatMap(({ through }) => through),
    };
  }
  if (parts.length > 0) {
    return { least: valueType, through: [valueType] };
  }
  const least =
    cyclePath(nodes, state, { from: value, to: holder, least: 'yes' }) ??
    cyclePath(nodes, state, { from: value, to: holder, least: 'depends' }) ??
    valueType;
  return { least, through: [valueType] };
}

/**
 * The least relevant type on a path from `from` to what reaches or is `to`, by what each value
 * reaches or holds, through values at least `least` relevant; undefined where there is none.
 */
function cyclePath(
  nodes: Nodes,
  state: FlowState,
  { from, to, least }: { readonly from: NodeId; readonly to: NodeId; readonly least: Relevance },
): Type | undefined {
  const allowed = (node: NodeId) => {
    const type = nodes.typeOf(node);
    return type !== undefined && !lessRelevant(nodes.relevanceOf(type), least);
  };
  const leastOf = new Map<NodeId, Type>();
  const pending = allowed(from) ? [from] : [];
  const typeOf = (node: NodeId) => nodes.typeOf(node) as Type;
  leastOf.set(from, typeOf(from));
  while (pending.length > 0) {
    const node = pending.shift() as NodeId;
    const found = leastOf.get(node) as Type;
    if (node === to || state.reach.closes(to, node)) {
      return found;
    }
    for (const next of [...state.reach.reachedFrom(node), ...state.reach.aliasesOf(node)]) {
      if (!leastOf.has(next) && allowed(next)) {
        const type = typeOf(next);
        leastOf.set(
          next,
          lessRelevant(nodes.relevanceOf(type), nodes.relevanceOf(found)) ? type : found,
        );
        pending.push(next);
      }
    }
  }
  return undefined;
}
