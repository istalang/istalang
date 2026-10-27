/**
 * Packs in lowering (§3.5): a function is compiled per instantiation, where a pack is a concrete
 * tuple, so its rest parameter is flattened into single parameters, one per element. A function
 * value of a pack's function then takes its arguments as its type says, `fn(int, string)` for a
 * pack of `(int, string)`, which keeps one calling convention for every call.
 *
 * - The entry takes the elements as parameters, and builds the pack's variable, the tuple, from
 *   them (function-lowering).
 * - A call passes a pack's arguments as single values, and a spread of a pack's value as its
 *   elements (expressions/calls.ts, emit-call.ts).
 */

import { unreachable } from '../../structures/unreachable.ts';
import type { SignatureParameter } from '../checker/check.ts';
import { isPack, type Type, tupleElements } from '../checker/types/type.ts';

/**
 * Whether `parameter` is a pack's rest parameter, which an instantiation flattens: its type is the
 * pack, or the tuple an instantiation substituted, never an array's.
 */
export function isPackParameter(parameter: Pick<SignatureParameter, 'node' | 'type'>): boolean {
  const { node, type } = parameter;
  return node.isRest && (isPack(type) || tupleElements(type) !== undefined);
}

/** The element types of a pack, `concrete` as an instantiation substitutes it: a tuple's. */
export function packElements(concrete: Type): readonly Type[] {
  return tupleElements(concrete) ?? unreachable('A pack is a tuple once instantiated.');
}
