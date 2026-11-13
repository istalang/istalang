/**
 * Values crossing between instances (§9, §10): an argument or result of a call one instance, or a
 * live run, makes into another, a mock's or a context's. Only values without handles cross,
 * except a host value a `dispose` made a resource, which crosses as its host's JSON: it leaves as
 * that JSON and arrives as the resource for it, the one the instance has already if any, so a handle
 * that crosses and comes back stays the same (§3.6). A mock records the values it is called with as
 * they would leave, its own instance's other handles kept (scheduler/testing/mocks.ts). Every value
 * crossing is rebuilt, so none is shared with the instance it left, which may change its own in
 * place (runtime/lifetimes/in-place.ts).
 */

import { isResourceType } from '../../../definition/tables/types.ts';
import { replacingParts } from '../../../definition/values/replacing.ts';
import {
  closureOf,
  handleTarget,
  handleTo,
  samePayload,
  type Value,
} from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { Panic } from '../../natives.ts';
import type { InstanceCall } from '../../snapshot/snapshot.ts';
import type { Instance } from './index.ts';

/**
 * `value` as it leaves `instance` for another, as an argument of a call or its answer; a panic for
 * a handle that can't leave, which only a mock's call can carry, since the checker keeps every other
 * crossing sendable (§3.1).
 */
export function leaving(instance: Instance, value: Value): Value {
  return hostValuesIn(instance, value, () => {
    throw new Panic(
      "A call to a mock another instance holds carries a value that isn't sendable (§10).",
    );
  });
}

/**
 * `value` with each handle to a resource in it made that resource's host value, and each other
 * handle what `other` makes it.
 */
export function hostValuesIn(
  instance: Instance,
  value: Value,
  other: (handle: Value) => Value,
): Value {
  return replacingParts(value, (part) => {
    const target = handleTarget(part);
    if (target === undefined) {
      return;
    }
    const object = instance.heap.objectOf(target);
    return object.kind === 'resource'
      ? { kind: 'extern', type: object.type, payload: object.payload }
      : other(part);
  });
}

/**
 * The call `closure`, a function taking nothing, makes as it leaves `instance`: a context's or a
 * spawned instance's, its captures leaving with it.
 */
export function leavingCall(instance: Instance, closure: Value): InstanceCall {
  const { function: called, captures } =
    closureOf(closure) ?? unreachable('A call leaves with no function; the checker forbids it.');
  return {
    function: called,
    captures: captures.map((each) => leaving(instance, each)),
    arguments: [],
  };
}

/**
 * `value`, arriving in `instance` from another: a host value of a resource type made its resource.
 */
export function arriving(instance: Instance, value: Value): Value {
  return replacingParts(value, (part) => {
    if (part.kind !== 'extern' || !isResourceType(instance.loaded.definition.types, part.type)) {
      return;
    }
    const known = instance.heap
      .objectsOf('resource')
      .find((each) => each.type === part.type && samePayload(each.payload, part.payload));
    const resource =
      known ??
      instance.heap.add((id) => ({ kind: 'resource', id, type: part.type, payload: part.payload }));
    return handleTo(resource.id);
  });
}
