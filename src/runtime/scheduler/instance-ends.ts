/**
 * Another instance's end, as a wait on it sees it (§9): `inst.result()` resolves once the instance's
 * last commit says it has ended, with `Ok` of its outcome or `Err` of its panic.
 *
 * - The first end counts: a panic, or the termination that followed one, which keeps it. A retry
 *   after it changes nothing for a wait already resolved.
 * - The end is read from the store, where every instance commits, so an outcome is copied from one
 *   snapshot into another and never passes through a host (§9). A test's runtime resolves it here
 *   too, from the store its world keeps; the world answers only a test's own waits (§10).
 * - Which instances an instance waits for this way is what a host reads (`watching`, wake.ts) to
 *   know whom to wake once one of them has ended.
 */

import { errorOf, okOf } from '../../definition/declared-values.ts';
import type { TypeId } from '../../definition/operands.ts';
import type { TypeDefinition } from '../../definition/types.ts';
import type { Value } from '../../definition/values.ts';
import { type Snapshot, snapshotFormat } from '../snapshot/snapshot.ts';
import type { InstanceStore } from '../store.ts';

/** The `code` of the `Error` a wait on an instance gets for its panic (§9). */
const panicCode = 'panic';

/**
 * The `Result` of type entry `result` a wait on the instance whose last commit is `snapshot` gets;
 * undefined until it has ended.
 */
function endOf(
  types: readonly TypeDefinition[],
  snapshot: Snapshot | undefined,
  result: TypeId,
): Value | undefined {
  const status = snapshot?.status;
  switch (status?.kind) {
    case 'finished':
      return okOf(types, result, status.outcome);
    case 'panicked':
    case 'terminated': {
      const { message, trace } = status;
      return errorOf(types, result, { message, code: panicCode, trace });
    }
    default:
      return undefined;
  }
}

/**
 * The end of `instance` as a `Result` of type entry `result`, read from its last commit in `store`;
 * undefined until it has ended. Every runtime resolves a wait on an end this way, a test's too.
 */
export function storedEnds(
  store: InstanceStore,
  types: readonly TypeDefinition[],
): (instance: string, result: TypeId) => Value | undefined {
  return (instance, result) => {
    const text = store.readSnapshot(instance);
    return endOf(types, text === undefined ? undefined : snapshotFormat.read(text), result);
  };
}
