/**
 * The cycle a write closes, by types (design.md §5.3), for what decides it to read off: the type
 * deciding whether it holds a disposable, and the types of what its value reaches its holder
 * through, which decide whether an instantiation can close it at all.
 *
 * - **The value's own type decides,** with the holder's: reach is closed under itself, so which
 *   values a value reaches its holder through isn't kept, and a path holds a disposable only where
 *   both ends may reach one; a value of a type parameter's type is decided by its instantiation.
 * - **A value this body made goes by its parts,** each a path of its own: its other parts don't
 *   reach the holder, so neither their types nor what they hold decide anything.
 */

import type { Type } from '../../../types/type/index.ts';
import { decidingType } from '../escaping.ts';
import type { NodeId } from '../reach-state.ts';
import type { TypedCycle } from '../summary.ts';
import { lessRelevant } from '../type-reach.ts';
import type { BodyAnalysis, Holder } from './body.ts';
import type { FlowState } from './flow-state.ts';

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
    sources: [],
    kind: exact ? 'reach' : 'share',
    deciding: path === undefined ? type : decidingType(analysis.context.facts, type, path.least),
  };
}

/**
 * The least relevant type deciding the cycle `value` closes with `holder`, and the types of what
 * it goes through: the parts of a value this body made that reach the holder, else the value.
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
  return { least: valueType, through: [valueType] };
}
