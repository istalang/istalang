/**
 * A test's host (§18): a test has no host but its mocks, so every extern of a test's Definition the
 * runtime's natives lack gets a native here. One no mock replaces panics the instance calling it,
 * except a host type's `dispose`, which does nothing: a test has nothing of its host's to release.
 */

import type { Definition } from '../../definition/tables/index.ts';
import { disposeOf, isResourceType } from '../../definition/tables/types.ts';
import { type Native, type Natives, Panic } from '../natives.ts';

/** A native for each extern of `definition` that `natives` lack (the banner). */
export function unmockedExterns(definition: Definition, natives: Natives): Natives {
  const { types } = definition;
  const releasing = new Set(
    types.flatMap((_, type) => (isResourceType(types, type) ? [disposeOf(types, type)] : [])),
  );
  const nothing: Native = () => null;
  return Object.fromEntries(
    definition.functions.flatMap((entry, index) => {
      if (entry.kind !== 'extern' || Object.hasOwn(natives, entry.key)) {
        return [];
      }
      return [[entry.key, releasing.has(index) ? nothing : unmocked(entry.name)]];
    }),
  );
}

/** The native of the extern `name` in a test no mock replaced: calling it panics. */
function unmocked(name: string): Native {
  return () => {
    throw new Panic(`No mock replaces ${name}, which a test's host would implement.`);
  };
}
