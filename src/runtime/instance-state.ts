/**
 * Where an instance stands after the runtime advanced it (§9): what a host needs to decide what to
 * do next. A waiting instance names when its earliest timer is due, so the host knows when to wake
 * it; an instance waiting on nothing the runtime can time names no time. A finished instance has
 * its outcome, the value `main` returned.
 *
 * It is derived from the committed snapshot alone (scheduler/wake.ts `stateOf`), so what a host is
 * told is always what a restarted runtime would tell it.
 */

import type { Value } from '../definition/values.ts';

export type InstanceState =
  | { readonly kind: 'waiting'; readonly until: bigint | undefined }
  | { readonly kind: 'finished'; readonly outcome: Value }
  | { readonly kind: 'panicked'; readonly message: string; readonly trace: string };
