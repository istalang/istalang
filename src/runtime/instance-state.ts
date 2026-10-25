/**
 * Where an instance stands (§9): what a host needs to decide what to do next. A waiting instance
 * names when its earliest timer is due, so the host knows when to wake it; an instance waiting on
 * nothing the runtime can time names no time. A ready instance was spawned and hasn't run yet, so
 * the host wakes it now. A finished instance has its outcome, the value its function returned.
 *
 * It is derived from the committed snapshot alone (scheduler/wake.ts `stateOf`), so what a host is
 * told is always what a restarted runtime would tell it. Advancing an instance also says which
 * instances it spawned (`Advanced`), the one thing a snapshot doesn't tell: the host runs those
 * too.
 */

import type { Value } from '../definition/values.ts';

export type InstanceState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'waiting'; readonly until: bigint | undefined }
  | { readonly kind: 'finished'; readonly outcome: Value }
  | { readonly kind: 'panicked'; readonly message: string; readonly trace: string }
  | { readonly kind: 'terminated' };

/** What advancing an instance did: where it stands now, and the instances it spawned (§9). */
export interface Advanced {
  readonly state: InstanceState;
  readonly spawned: readonly string[];
}
