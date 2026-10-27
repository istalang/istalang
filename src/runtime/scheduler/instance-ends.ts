/**
 * Another instance's end, as a wait on it sees it (§9): `inst.result()` resolves once the instance's
 * last commit says it has ended, with `Ok` of its outcome or `Err` of its panic.
 *
 * - The first end counts: a panic, or the termination that followed one, which keeps it. A retry
 *   after it changes nothing for a wait already resolved.
 * - The end is read from the store, where every instance commits, so an outcome is copied from one
 *   snapshot into another and never passes through a host (§9). Under a test, the world reads it the
 *   same way from its own store (runtime/testing/).
 * - Which instances an instance waits for this way is what a host reads (`watching`, wake.ts) to
 *   know whom to wake once one of them has ended.
 */

import { namedType, structOf, variantOf, variantShape } from '../../definition/declared-values.ts';
import type { TypeId } from '../../definition/operands.ts';
import type { TypeDefinition } from '../../definition/types.ts';
import type { Value } from '../../definition/values.ts';
import { resultVariants } from '../../language/well-known.ts';
import type { InstanceState } from '../instance-state.ts';
import { type Snapshot, snapshotFormat } from '../snapshot/snapshot.ts';
import type { InstanceStore } from '../store.ts';
import type { Watch } from './futures.ts';

/** The `code` of the `Error` a wait on an instance gets for its panic (§9). */
const panicCode = 'panic';

/** Whether an instance in `state` has ended, as `endOf` reads its last commit. */
export function hasEnded({ kind }: InstanceState): boolean {
  return kind === 'finished' || kind === 'panicked' || kind === 'terminated';
}

/**
 * The `Result` of type entry `result` a wait on the instance whose last commit is `snapshot` gets;
 * undefined until it has ended.
 */
export function endOf(
  types: readonly TypeDefinition[],
  snapshot: Snapshot | undefined,
  result: TypeId,
): Value | undefined {
  const status = snapshot?.status;
  switch (status?.kind) {
    case 'finished':
      return variantOf(types, result, resultVariants.ok, { value: status.outcome });
    case 'panicked':
    case 'terminated': {
      const error = namedType(variantShape(types, result, resultVariants.err).fields[0]?.type);
      const { message, trace } = status;
      return variantOf(types, result, resultVariants.err, {
        error: structOf(types, error, { message, code: panicCode, trace }),
      });
    }
    default:
      return undefined;
  }
}

/**
 * What a pending watch resolves with outside a test: the end of the instance it waits for, read
 * from `store`. A test's own waits (`idle`, `reaches`) never hold here, since only the runtime
 * running the test can tell them (runtime/testing/).
 */
export function storedEnds(
  store: InstanceStore,
  types: readonly TypeDefinition[],
): (watch: Watch) => Value | undefined {
  return ({ instance, until }) => {
    if (until.kind !== 'ended') {
      return;
    }
    const text = store.readSnapshot(instance);
    return endOf(types, text === undefined ? undefined : snapshotFormat.read(text), until.result);
  };
}
