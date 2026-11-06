/**
 * The natives of the prelude's `Slot<T>` (spec §6): the runtime's slots, which every wait in the
 * language is on. Each operation returns its future; what an operation waits for and how the
 * slot's queue is served are the runtime's (runtime/scheduler/instance/slots.ts).
 */

import { parameterKey } from '../../definition/extern-key.ts';
import { wellKnown } from '../../language/well-known/index.ts';
import type { NativeContext, Natives, WithSlots } from '../../runtime/natives.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';
import { given } from '../values/arguments.ts';

const value = parameterKey('T');
const slot = knownTypeKey(wellKnown.slot, value);

export const slotNatives = (keys: NativeKeys): Natives<NativeContext & WithSlots> => ({
  [keys.ofStatic(wellKnown.slot.name, 'create')]: (_arguments, context) => context.slots.create(),
  [keys.of('put', slot, value)]: ([target, put], context) =>
    context.slots.put(given(target), given(put)),
  [keys.of('take', slot)]: ([target], context) => context.slots.take(given(target)),
  [keys.of('read', slot)]: ([target], context) => context.slots.read(given(target)),
});
