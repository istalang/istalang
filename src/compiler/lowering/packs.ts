/**
 * Packs in lowering (§3.5): a function is compiled per instantiation, where a pack is a concrete
 * tuple, so its rest parameter is flattened into single parameters, one per element. A function
 * value of a pack's function then takes its arguments as its type says, `fn(Int, String)` for a
 * pack of `(Int, String)`, which keeps one calling convention for every call.
 *
 * - The entry takes the elements as parameters, and builds the pack's variable, the tuple, from
 *   them (function-lowering).
 * - A call passes a pack's arguments as single values, and a spread of a pack's value as its
 *   elements (emit-call.ts; expressions/calls.ts for a function value's call).
 */

import type { Register } from '../../definition/operands.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { type Type, tupleElements } from '../checker/types/type.ts';
import type { AnchoredSpan } from '../syntax/positions.ts';
import type { CodeContext } from './context.ts';

/** The element types of a pack, `concrete` as an instantiation substitutes it: a tuple's. */
export function packElements(concrete: Type): readonly Type[] {
  return tupleElements(concrete) ?? unreachable('A pack is a tuple once instantiated.');
}

/**
 * The elements of the pack's tuple in `tuple`, of the `type` an instantiation gives, each read by
 * position at `span`, as `t.0` reads one (expressions/tuples.ts).
 */
export function packElementsOf(
  context: CodeContext,
  tuple: Register,
  { type, span }: { readonly type: Type; readonly span: AnchoredSpan },
): readonly Register[] {
  return packElements(type).map((_, index) => context.code.field(tuple, index, span));
}
