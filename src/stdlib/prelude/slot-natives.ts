/**
 * The natives of the prelude's `Slot<T>` (spec §6): the runtime's slots, which every wait in the
 * language is on. Each operation returns its future; what an operation waits for and how the
 * slot's queue is served are the runtime's (runtime/scheduler/slots.ts).
 */

import { namedKey, nativeKey, parameterKey } from '../../definition/extern-key.ts';
import { qualifiedName, wellKnown } from '../../language/well-known.ts';
import type { Natives } from '../../runtime/natives.ts';
import { given } from '../native-values.ts';

const { module, name } = wellKnown.slot;
const value = parameterKey('T');
const slot = namedKey(qualifiedName(wellKnown.slot), value);

export const slotNatives: Natives = {
  [nativeKey(module, `${name}.create`)]: (_arguments, context) => context.slots.create(),
  [nativeKey(module, 'put', slot, value)]: ([target, put], context) =>
    context.slots.operate(given(target), 'put', given(put)),
  [nativeKey(module, 'take', slot)]: ([target], context) =>
    context.slots.operate(given(target), 'take'),
  [nativeKey(module, 'read', slot)]: ([target], context) =>
    context.slots.operate(given(target), 'read'),
};
