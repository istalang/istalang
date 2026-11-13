/**
 * Values frozen, as a constant or a restored value is shared with other instances: a write in place
 * into any of them throws, so a test sees one at once.
 */

import { childValues, isComposite, type Value } from '../../definition/values/values.ts';

const compositeKinds = new Set(['tuple', 'struct', 'variant', 'array', 'map', 'closure']);

/** `value`, and every part of it, frozen. */
export function frozen(value: Value): Value {
  if (isComposite(value)) {
    for (const part of childValues(value)) {
      frozen(part);
    }
    if (value.kind === 'map') {
      for (const entry of value.entries) {
        Object.freeze(entry);
      }
      Object.freeze(value.entries);
    }
    Object.freeze('elements' in value ? value.elements : undefined);
    Object.freeze('fields' in value ? value.fields : undefined);
    Object.freeze('captures' in value ? value.captures : undefined);
    Object.freeze(value);
  }
  return value;
}

/**
 * Freezes every composite value found anywhere in `data`, such as a snapshot, leaving what holds
 * them, frames and objects, as they are.
 */
export function freezeValuesIn(data: unknown): void {
  const pending: unknown[] = [data];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next === 'object' && next !== null && !Object.isFrozen(next)) {
      if ('kind' in next && compositeKinds.has(String(next.kind))) {
        frozen(next as Value);
      } else {
        pending.push(...Object.values(next));
      }
    }
  }
}
