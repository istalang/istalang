/**
 * Where an instance stands (§9): what a host needs to decide what to do next. A waiting instance
 * names when its earliest timer is due, so the host knows when to wake it; an instance waiting on
 * nothing the runtime can time names no time. A ready instance was spawned and hasn't run yet, so
 * the host wakes it now. A finished instance has its outcome, the value its function returned.
 *
 * It is derived from the committed snapshot alone (scheduler/wake.ts `stateOf`), so what a host is
 * told is always what a restarted runtime would tell it. Advancing an instance also says what a
 * snapshot doesn't tell (`Advanced`): which instances it spawned, which the host runs too, and the
 * log records its committed segments wrote (§3.8 `log`), which no snapshot keeps.
 */

import type { Value } from '../definition/values.ts';

export type InstanceState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'waiting'; readonly until: bigint | undefined }
  | { readonly kind: 'finished'; readonly outcome: Value }
  | { readonly kind: 'panicked'; readonly message: string; readonly trace: string }
  | { readonly kind: 'terminated' };

/** A log record (§3.8 `log`), as a committed segment of `instance` wrote it. */
export interface LogRecord {
  readonly instance: string;
  /** When its segment started, in milliseconds since the Unix epoch, as `now()` read then (§5). */
  readonly time: bigint;
  /** The name of its `log.Level` variant, lowercased: `debug`, `info`, `warn` or `error`. */
  readonly level: string;
  readonly message: string;
  /** Its fields as the JSON a host works with (§9). */
  readonly fields: unknown;
}

/**
 * What advancing an instance did: where it stands now, the instances it spawned and the log
 * records its committed segments wrote, in order (§9).
 */
export interface Advanced {
  readonly state: InstanceState;
  readonly spawned: readonly string[];
  readonly logs: readonly LogRecord[];
}
