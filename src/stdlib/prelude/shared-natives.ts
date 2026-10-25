/**
 * The natives of the prelude's `Shared<T>` (spec §3.8): a handle to a cell of the instance's own
 * memory, the same cells a variable passed by `&` or captured by a closure lives in (§3.14), so
 * every copy of a handle reads and writes one value.
 *
 * `Shared(v)` makes the cell as the `Shared<T>` its call returns, which the extern entry's result
 * names, so the cell's type entry knows whether disposing it calls a `dispose` (§7).
 */

import { namedKey, nativeKey, parameterKey } from '../../definition/extern-key.ts';
import type { FunctionDefinition } from '../../definition/functions.ts';
import type { TypeId } from '../../definition/operands.ts';
import {
  qualifiedName,
  rewrapFunction,
  unwrapFunction,
  wellKnown,
} from '../../language/well-known.ts';
import type { Natives } from '../../runtime/natives.ts';
import { given } from '../native-values.ts';

const { module, name } = wellKnown.shared;
const value = parameterKey('T');
const shared = namedKey(qualifiedName(wellKnown.shared), value);

export const sharedNatives: Natives = {
  [nativeKey(module, `${name}.from`, value)]: ([initial], context) =>
    context.cells.create(sharedTypeOf(context.entry), given(initial)),
  [nativeKey(module, unwrapFunction, shared)]: ([cell], context) => context.cells.read(given(cell)),
  [nativeKey(module, rewrapFunction, shared, value)]: ([cell, next], context) => {
    context.cells.write(given(cell), given(next));
    return null;
  },
};

/** The `Shared<T>` type entry the extern `entry` returns. */
function sharedTypeOf(entry: FunctionDefinition): TypeId {
  if (entry.kind !== 'extern' || entry.result.kind !== 'named') {
    throw new TypeError(`${entry.name} doesn't return a Shared value.`);
  }
  return entry.result.type;
}
