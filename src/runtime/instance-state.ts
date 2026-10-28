/**
 * Where an instance stands (§9): what a host needs to decide what to do next. A waiting instance
 * names when its earliest timer is due, so the host knows when to wake it, an instance waiting on
 * nothing the runtime can time naming no time, and the instances whose end it waits for, so the
 * host wakes it once one of them has ended. A ready instance was spawned and hasn't run yet, so
 * the host wakes it now. A finished instance has its outcome, the value its function returned, and
 * that outcome as `Json` when its type has a codec writing it, which is what a host reads (§9).
 *
 * It is derived from the committed snapshot alone (scheduler/wake.ts `stateOf`), so what a host is
 * told is always what a restarted runtime would tell it. Advancing an instance also says what a
 * snapshot doesn't tell (`Advanced`): which instances it spawned, which the host runs too, and the
 * log records its committed segments wrote (§3.8 `log`), which no snapshot keeps.
 */

import type { FunctionId } from '../definition/operands.ts';
import type { Value } from '../definition/values.ts';

export type InstanceState =
  | { readonly kind: 'ready' }
  | {
      readonly kind: 'waiting';
      readonly until: bigint | undefined;
      readonly watching: readonly string[];
    }
  | { readonly kind: 'finished'; readonly outcome: Value; readonly encoded?: Value | undefined }
  | { readonly kind: 'panicked'; readonly message: string; readonly trace: string }
  | { readonly kind: 'terminated'; readonly message: string; readonly trace: string };

/** A finished instance's state: its outcome, and that outcome's JSON when a codec writes it. */
export type Finished = Extract<InstanceState, { kind: 'finished' }>;

/** The level of a log record (§3.8 `log`): its `log.Level` variant, as a host reads it. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** A log record (§3.8 `log`), as a committed segment of `instance` wrote it. */
export interface LogRecord {
  readonly instance: string;
  /** When its segment started, in milliseconds since the Unix epoch, as `now()` read then (§5). */
  readonly time: bigint;
  readonly level: LogLevel;
  readonly message: string;
  /** Its fields as the JSON a host works with (§9). */
  readonly fields: unknown;
}

/** How a new instance runs: options it keeps for its whole life (§10). */
export interface StartOptions {
  /** Every segment runs twice, the first run discarded, before it commits. */
  readonly crashEveryAwait?: boolean;
}

/** How an instance an instance spawns runs: a host's options, and those only the runtime sets. */
export interface SpawnOptions extends StartOptions {
  /** A panic terminates the instance at once, as `runtime.isolate` starts it (§9). */
  readonly terminatesOnPanic?: boolean;
  /**
   * The entry encoding its outcome as JSON for its host (§9), when a codec writes the outcome's
   * type: the codec's.
   */
  readonly encoder?: FunctionId | undefined;
}

/** Whether an instance in `state` has ended, so a wait on its end resolves (§9). */
export function hasEnded({ kind }: InstanceState): boolean {
  return kind === 'finished' || kind === 'panicked' || kind === 'terminated';
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

/** Where one execution waits: its waypoint, if the program named it, and its source location. */
export interface WaitingPoint {
  readonly waypoint: string | undefined;
  /** `module:line:column`, as a trace names it. */
  readonly location: string;
}

/** Where a committed instance stands and where each of its executions waits (§9, §10). */
export interface Inspection {
  readonly state: InstanceState;
  /** Every execution's wait, in the order the executions were created. */
  readonly waitingAt: readonly WaitingPoint[];
}
