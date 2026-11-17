/**
 * The host binding (ir-first design, decision 10): what a host binds every program it runs to, in
 * one shape for a host's runtime (index.ts), a single start of a program (runtime/program.ts, and
 * `istalang/live` through it) and a test's world (testing/test-world.ts).
 */

import type { HostExterns } from '../boundary/host-natives.ts';
import type { Clock } from '../clock.ts';
import type { LogRecord } from '../instance-state.ts';
import type { Natives } from '../natives.ts';
import type { InstanceStore } from '../store.ts';

/**
 * The natives of the std, the host's externs written against JSON, its clock, the seed of the
 * random source of each instance it makes, the store its instances commit to, and what it hears of
 * the instances it doesn't advance itself.
 */
export interface HostBinding {
  readonly natives: Natives;
  readonly externs?: HostExterns;
  readonly clock: Clock;
  readonly seed: () => Uint8Array;
  readonly store: InstanceStore;
  readonly reports?: HostReports;
}

/** What a host hears of the instances it doesn't advance itself: their log records and panics. */
export interface HostReports {
  readonly logs: (records: readonly LogRecord[]) => void;
  readonly panicked: (
    instance: string,
    panic: { readonly message: string; readonly trace: string },
  ) => void;
}
