/**
 * The native of the prelude's `Shared(v)` (spec §3.8), which every handle's `H(v)` is bound to
 * (§3.18): it makes a cell of the instance's own memory, the same cells a variable passed by `&` or
 * captured by a closure lives in (§3.14), as the handle its call returns. `*x` reads and writes the
 * cell with instructions of its own.
 *
 * The cell's type entry is the one the extern entry's result names (its declared result), so it
 * knows whether disposing the cell calls a `dispose` (§7).
 */

import { nativeKey, parameterKey } from '../../definition/extern-key.ts';
import { conversionFunction, wellKnown } from '../../language/well-known.ts';
import type { NativeContext, Natives, WithCells } from '../../runtime/natives.ts';
import { declaredResult, given } from '../native-values.ts';

const { module, name } = wellKnown.shared;
const value = parameterKey('T');

export const sharedNatives: Natives<NativeContext & WithCells> = {
  [nativeKey(module, `${name}.${conversionFunction}`, value)]: ([initial], context) =>
    context.cells.create(declaredResult(context), given(initial)),
};
