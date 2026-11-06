/**
 * The arguments a pack's rest parameter takes (§3.5), as choosing judges them (choice.ts): single
 * values by position, which fill the pack together as the tuple of their types, or one spread of a
 * value of a pack, which fills it as that pack. Either is matched exactly, since a pack is opaque:
 * its items convert into nothing, and the pack of the function a value is spread inside is the
 * only one it fills.
 */

import type { Inference } from '../inference/infer.ts';
import type { Binding } from '../surface/resolved-call.ts';
import { isPack } from '../types/function-types.ts';
import { type Type, tupleType } from '../types/type.ts';
import type { CallArgument, Inapplicability, Takes } from './call-arguments.ts';

/** The arguments `binding` gives the pack rest parameters of `takes`, by argument number. */
export function packItems(takes: Takes, binding: Binding): ReadonlySet<number> {
  return new Set(
    takes.parameters.flatMap((slot, parameter) => {
      const source = binding[parameter];
      const fillsPack = slot.rest?.kind === 'pack' && source?.kind === 'rest';
      return fillsPack ? source.items.map(({ index }) => index) : [];
    }),
  );
}

/**
 * Why the arguments a pack's rest parameter collects don't fill it, if they don't, matching them
 * against it meanwhile.
 */
export function packInapplicability(
  takes: Takes,
  binding: Binding,
  callArguments: readonly CallArgument[],
  inference: Inference,
): Inapplicability | undefined {
  for (const [parameter, slot] of takes.parameters.entries()) {
    const source = binding[parameter];
    if (slot.rest?.kind === 'pack' && source?.kind === 'rest') {
      const found = packOf(source.items.map(({ index }) => callArguments[index]));
      if (found === undefined || !inference.matchExactly(slot.type, found)) {
        const expected = inference.substituted(slot.type);
        return { kind: 'pack', index: source.items[0]?.index ?? 0, expected, found };
      }
    }
  }
  return undefined;
}

/**
 * The type `items` fill a pack with: one spread of a pack's value, that pack; single values by
 * value, the tuple of their types; undefined for anything else.
 */
function packOf(items: readonly (CallArgument | undefined)[]): Type | undefined {
  const [only] = items;
  if (items.length === 1 && only?.isSpread === true) {
    return only.type !== undefined && isPack(only.type) ? only.type : undefined;
  }
  const types: Type[] = [];
  for (const item of items) {
    if (item?.type === undefined || item.isSpread === true || item.passing !== 'value') {
      return undefined;
    }
    types.push(item.type);
  }
  return tupleType(types);
}
