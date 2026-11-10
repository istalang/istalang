/**
 * An `Instance<T>` (§9) is a value of its extern type entry whose payload is the name of the
 * instance it is a handle to. This is the one home of that shape: the natives that spawn, and those
 * that read a handle, go through it.
 */

import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { TypeId } from '../operands.ts';
import { isComposite, type Value } from './values.ts';

/** A handle of `Instance<T>` type entry `type` to the instance named `name`. */
export function instanceHandle(type: TypeId, name: string): Value {
  return { kind: 'extern', type, payload: name };
}

/** The name of the instance `handle` is a handle to. */
export function instanceNameOf(handle: Value | undefined): string {
  return handle !== undefined &&
    isComposite(handle) &&
    handle.kind === 'extern' &&
    typeof handle.payload === 'string'
    ? handle.payload
    : unreachable('Expected an Instance handle.');
}
