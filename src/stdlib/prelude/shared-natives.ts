/**
 * The natives of the prelude's `Shared<T>` (spec §3.8), which every handle's functions are bound to
 * (§3.18): a handle to a cell of the instance's own memory, the same cells a variable passed by `&`
 * or captured by a closure lives in (§3.14), so every copy of a handle reads and writes one value.
 *
 * `H(v)` makes the cell as the handle its call returns, which the extern entry's result names (its
 * declared result), so the cell's type entry knows whether disposing it calls a `dispose` (§7).
 */

import { namedKey, nativeKey, parameterKey } from '../../definition/extern-key.ts';
import {
  conversionFunction,
  qualifiedName,
  rewrapFunction,
  unwrapFunction,
  wellKnown,
} from '../../language/well-known.ts';
import type { NativeContext, Natives, WithCells } from '../../runtime/natives.ts';
import { declaredResult, given } from '../native-values.ts';

const { module, name } = wellKnown.shared;
const value = parameterKey('T');
const shared = namedKey(qualifiedName(wellKnown.shared), value);

export const sharedNatives: Natives<NativeContext & WithCells> = {
  [nativeKey(module, `${name}.${conversionFunction}`, value)]: ([initial], context) =>
    context.cells.create(declaredResult(context), given(initial)),
  [nativeKey(module, unwrapFunction, shared)]: ([cell], context) => context.cells.read(given(cell)),
  [nativeKey(module, rewrapFunction, shared, value)]: ([cell, next], context) => {
    context.cells.write(given(cell), given(next));
    return null;
  },
};
