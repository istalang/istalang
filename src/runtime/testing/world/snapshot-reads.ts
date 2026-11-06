/**
 * What a test's world reads from an instance's last commit beyond what a host inspects (§10): the
 * test watches (`idle`, `reaches`) it waits on, and the answers it holds for calls whose callers
 * no longer wait on them. Only an active instance holds either.
 */

import type { CallerFuture } from '../../scheduler/testing/test-world.ts';
import type { HeapObject, TestWatch } from '../../snapshot/objects.ts';
import type { Snapshot } from '../../snapshot/snapshot.ts';

/** The heap objects of `snapshot` while it is active; none once it has ended or before it starts. */
function activeObjects(snapshot: Snapshot | undefined): readonly HeapObject[] {
  return snapshot?.status.kind === 'active' ? snapshot.objects : [];
}

/** The test watches (`idle`, `reaches`) pending in `snapshot`. */
export function pendingTestWatches(
  snapshot: Snapshot | undefined,
): readonly { readonly instance: string; readonly until: TestWatch }[] {
  return activeObjects(snapshot).flatMap((object) =>
    object.kind === 'future' && object.state.kind === 'watch' && object.state.until.kind !== 'ended'
      ? [{ instance: object.state.instance, until: object.state.until }]
      : [],
  );
}

/**
 * The answers `holder` still holds for calls from `caller` whose futures `callerSnapshot` no
 * longer waits on (§10).
 */
export function withdrawnAnswers(
  holder: Snapshot | undefined,
  caller: string,
  callerSnapshot: Snapshot | undefined,
): readonly CallerFuture[] {
  // A panicked caller's snapshot still holds its futures for a retry, while a finished or terminated one has none.
  const waiting = new Set(
    (callerSnapshot?.objects ?? []).flatMap((object) =>
      object.kind === 'future' && object.state.kind === 'host' ? [object.state.token] : [],
    ),
  );
  return activeObjects(holder).flatMap((object) =>
    object.kind === 'answer' && object.instance === caller && !waiting.has(object.token)
      ? [{ instance: caller, token: object.token }]
      : [],
  );
}
