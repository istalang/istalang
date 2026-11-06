/**
 * A test's host (§10): a test has no host but its mocks, so every extern a test's Definition
 * declares and the runtime's natives lack gets a native here, one that says no mock replaced it.
 */

import type { Definition } from '../../../definition/definition.ts';
import { jsonOfPlain, jsonTypeOf } from '../../../definition/values/json-values.ts';
import { type Native, type Natives, Panic } from '../../natives.ts';

/**
 * A test's host (§10), for each extern of `definition` the runtime's `natives` lack: one no mock
 * replaces panics, except a host type's `dispose`, the native its type entry names
 * (definition/tables/types.ts), which does nothing, since the test has nothing of its host's to
 * release, and gives back the JSON `null` a host's function returning nothing gives (§9).
 */
export function unmockedExterns(definition: Definition, natives: Natives): Natives {
  const releasing = new Set(
    definition.types.flatMap((entry) =>
      entry.kind === 'extern' &&
      entry.disposal.kind === 'function' &&
      entry.disposal.host !== undefined
        ? [entry.disposal.host]
        : [],
    ),
  );
  const nothing: Native = () => jsonOfPlain(null, jsonTypeOf(definition.types));
  return Object.fromEntries(
    definition.functions.flatMap((entry, index) => {
      if (entry.kind !== 'extern' || Object.hasOwn(natives, entry.key)) {
        return [];
      }
      const native = releasing.has(index) ? nothing : unmocked(entry.name);
      return [[entry.key, native]];
    }),
  );
}

/** The native of the extern `name` in a test no mock replaced: calling it panics. */
function unmocked(name: string): Native {
  return () => {
    throw new Panic(`No mock replaces ${name}, which a test's host would implement.`);
  };
}
