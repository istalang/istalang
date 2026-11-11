/**
 * Values crossing between instances (§9, §10): an argument or result of a call one instance, or a
 * live run, makes into another, a mock's or a context's. Only values without handles cross,
 * except a host value a `dispose` made a resource, which crosses as its host's JSON: it leaves as
 * that JSON and arrives as the resource for it, the one the instance has already if any, so a handle
 * that crosses and comes back stays the same (§3.6).
 */

import { isResourceType } from '../../../definition/tables/types.ts';
import {
  childValues,
  handleTarget,
  handleTo,
  isComposite,
  samePayload,
  type Value,
  withChildValues,
} from '../../../definition/values/values.ts';
import { Panic } from '../../natives.ts';
import type { Instance } from './index.ts';

/**
 * `value` as it leaves `instance` for another, as an argument of a call or its answer; a panic for
 * a handle that can't leave, which only a mock's call can carry, since the checker keeps every other
 * crossing sendable (§3.1).
 */
export function leaving(instance: Instance, value: Value): Value {
  if (!isComposite(value)) {
    return value;
  }
  const target = handleTarget(value);
  if (target !== undefined) {
    const object = instance.heap.objectOf(target);
    if (object.kind !== 'resource') {
      throw new Panic(
        "A call to a mock another instance holds carries a value that isn't sendable (§10).",
      );
    }
    return { kind: 'extern', type: object.type, payload: object.payload };
  }
  return withChildValues(
    value,
    childValues(value).map((child) => leaving(instance, child)),
  );
}

/**
 * `value`, arriving in `instance` from another: a host value of a resource type made its resource.
 */
export function arriving(instance: Instance, value: Value): Value {
  if (!isComposite(value)) {
    return value;
  }
  if (value.kind === 'extern' && isResourceType(instance.loaded.definition.types, value.type)) {
    const known = instance.heap
      .objectsOf('resource')
      .find((each) => each.type === value.type && samePayload(each.payload, value.payload));
    const resource =
      known ??
      instance.heap.add((id) => ({
        kind: 'resource',
        id,
        type: value.type,
        payload: value.payload,
      }));
    return handleTo(resource.id);
  }
  return withChildValues(
    value,
    childValues(value).map((child) => arriving(instance, child)),
  );
}
