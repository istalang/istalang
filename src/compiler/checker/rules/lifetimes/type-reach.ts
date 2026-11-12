/**
 * What a type's values may reach, read off declarations alone (design.md §5.1, §5.5): whether they
 * reach a disposable, and which handles they hold and may come to reach, the declaration graph
 * that stands in for code the analysis doesn't see.
 *
 * - **Relevance** is the most any type a value holds at any depth (`heldTypes`) says: a disposable
 *   says yes, and so does a plain function or an `any` value, which hold what they capture or
 *   dispatch to, which no type shows (until C4: `heldOfFunction`); a type parameter says it
 *   depends on its instantiation. A sendable type reaches nothing of its instance.
 * - **Handles at the grain of their declarations:** a value of a type holds some handles directly,
 *   not through another handle (`top`), and may reach others through their cells (`inner`). Type
 *   arguments are not told apart (`Slot<A>` and `Slot<B>` are one `Slot`), so the graph only ever
 *   says more than the types do, never less. What a function, a type parameter or an `any` value
 *   holds is any handle at all.
 */

import type { CheckerContext } from '../../contexts/context.ts';
import { isHandleType } from '../../types/properties/handles.ts';
import { heldPartsOf, heldTypes } from '../../types/properties/held.ts';
import { isSendable } from '../../types/traits/sendable.ts';
import { isSendableFunction } from '../../types/type/function-types.ts';
import type { FunctionType, NominalEntity, NominalType, Type } from '../../types/type/index.ts';
import { isDisposable } from '../disposal/disposal.ts';

/** Whether values of a type may reach a disposable: never, always, or as instantiation decides. */
export type Relevance = 'no' | 'depends' | 'yes';

const order: Readonly<Record<Relevance, number>> = { no: 0, depends: 1, yes: 2 };

/** The more of two relevances. */
export function moreRelevant(first: Relevance, second: Relevance): Relevance {
  return order[first] >= order[second] ? first : second;
}

/** Whether values of `type` may reach a disposable, at any depth. */
export function relevanceOf(checker: CheckerContext, type: Type): Relevance {
  if (isSendable(checker, type)) {
    return 'no';
  }
  return heldTypes(checker, type).reduce<Relevance>(
    (most, part) => (most === 'yes' ? most : moreRelevant(most, ownRelevance(checker, part))),
    'no',
  );
}

/** What `type` itself says of reaching a disposable, apart from what it holds. */
function ownRelevance(checker: CheckerContext, type: Type): Relevance {
  if (isDisposable(checker, type)) {
    return 'yes';
  }
  switch (type.kind) {
    case 'function':
      return heldOfFunction(type);
    case 'any':
      return isSendable(checker, type) ? 'no' : 'yes';
    case 'parameter':
    case 'associated':
    case 'field':
      return isSendable(checker, type) ? 'no' : 'depends';
    default:
      return 'no';
  }
}

/**
 * The seam C4 refines (design.md §5.6): what a plain function value may hold, until then anything,
 * since what it captures is no part of its type. A sendable one captures only sendable values.
 */
function heldOfFunction(type: FunctionType): Relevance {
  return isSendableFunction(type) ? 'no' : 'yes';
}

/** Handles by declaration, or any handle at all. */
type Handles = 'any' | ReadonlySet<NominalEntity>;

/** The handles a value of a type holds directly (`top`), and those it may reach through them. */
export interface HandleReach {
  readonly top: Handles;
  readonly inner: Handles;
}

/** The handles values of `type` hold and may reach (the declaration graph's answer for it). */
export function handleReachOf(checker: CheckerContext, type: Type): HandleReach {
  const top = topHandlesOf(checker, type);
  if (top.any) {
    return { top: 'any', inner: 'any' };
  }
  const inner = new Set<NominalEntity>();
  const seen = new Set<string>();
  const pending = [...top.handles];
  while (pending.length > 0) {
    const handle = pending.pop() as NominalType;
    const key = checker.typeKeys.typeKey(handle);
    const held = seen.has(key)
      ? []
      : heldPartsOf(checker, handle).map((part) => topHandlesOf(checker, part));
    seen.add(key);
    if (held.some(({ any }) => any)) {
      return { top: entitiesOf(top.handles), inner: 'any' };
    }
    for (const each of held.flatMap(({ handles }) => handles)) {
      inner.add(each.entity);
      pending.push(each);
    }
  }
  return { top: entitiesOf(top.handles), inner };
}

/** Whether a value reaching `holder`'s inner handles may reach what `value` holds at its top. */
export function mayReach(holder: HandleReach, value: HandleReach): boolean {
  return meet(holder.inner, value.top);
}

/** Whether two values may hold one handle directly. */
export function mayAlias(first: HandleReach, second: HandleReach): boolean {
  return meet(first.top, second.top);
}

/** Whether two values may reach one handle, at any depth. */
export function mayShare(first: HandleReach, second: HandleReach): boolean {
  return (
    meet(first.top, second.top) ||
    meet(first.top, second.inner) ||
    meet(first.inner, second.top) ||
    meet(first.inner, second.inner)
  );
}

/** Whether two handle sets may share a handle. */
function meet(first: Handles, second: Handles): boolean {
  if (first === 'any') {
    return second === 'any' || second.size > 0;
  }
  if (second === 'any') {
    return first.size > 0;
  }
  for (const each of first) {
    if (second.has(each)) {
      return true;
    }
  }
  return false;
}

/** Whether two handle reaches say alike, for an entry's cutoff. */
export function sameHandleReach(first: HandleReach, second: HandleReach): boolean {
  return sameHandles(first.top, second.top) && sameHandles(first.inner, second.inner);
}

function sameHandles(first: Handles, second: Handles): boolean {
  if (first === 'any' || second === 'any') {
    return first === second;
  }
  return first.size === second.size && [...first].every((each) => second.has(each));
}

interface TopHandles {
  readonly any: boolean;
  readonly handles: readonly NominalType[];
}

/**
 * The handles a value of `type` holds without crossing another handle: a handle itself, and
 * the handles a value's parts hold; any at all for a plain function, a type parameter or an `any`
 * value. A recursive value type holds nothing more where it recurs.
 */
function topHandlesOf(checker: CheckerContext, type: Type): TopHandles {
  const handles: NominalType[] = [];
  const seen = new Set<string>();
  const walk = (part: Type): boolean => {
    if (isHandleType(part)) {
      handles.push(part);
      return false;
    }
    if (ownRelevance(checker, part) !== 'no') {
      return true;
    }
    const key = checker.typeKeys.typeKey(part);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return heldPartsOf(checker, part).some(walk);
  };
  return { any: walk(type), handles };
}

function entitiesOf(handles: readonly NominalType[]): ReadonlySet<NominalEntity> {
  return new Set(handles.map((handle) => handle.entity));
}
