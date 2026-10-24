/**
 * Where an instance stands after the runtime advanced it (§9): what a host needs to decide what to
 * do next. A waiting instance names when its earliest timer is due, so the host knows when to wake
 * it; an instance waiting on nothing the runtime can time names no time.
 */

import type { Value } from '../definition/values.ts';

export type InstanceState =
  | { readonly kind: 'waiting'; readonly until: bigint | undefined }
  | { readonly kind: 'finished'; readonly value: Value }
  | { readonly kind: 'panicked'; readonly message: string; readonly trace: string };
