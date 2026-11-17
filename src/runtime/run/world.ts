/**
 * The instances one host's run drives (§5, §9): the live run a host started and every ista
 * instance its code reaches, each a `Run` of its own, so nothing one holds is ever another's.
 * They meet only through a `World` (host/durable-world.ts): a call into a context, a spawn, a wait
 * on an instance's end, and the runtimes live code opens over the host's store. What crosses is a sendable value, copied, so no composite is shared
 * by two runs' counts; and each answer arrives in the waiting run as a turn of its own
 * (`Run.arrive`), never inside another run's step, acting on the future it settles in whichever run
 * of its instance it lands in.
 */

import type { TypeId } from '../../definition/operands.ts';
import type { Value } from '../../definition/values/values.ts';
import type { Inspection, SpawnOptions } from '../instance-state.ts';
import type { ContextCall, TestWatch } from '../natives.ts';
import type { HeldMock } from './mock-answers.ts';
import type { Future } from './objects/future.ts';
import type { Run } from './run.ts';

/** What one run asks of the instances beside it. */
export interface World {
  /** Starts `closure` as a new instance `parent` spawned (§9); the new instance's name. */
  readonly spawn: (parent: Run, closure: Value, spawning: Spawning) => string;
  /** Makes `call` into its context (§9), settling `future`, in `caller`, with how it ended. */
  readonly call: (caller: Run, call: ContextCall, future: Future) => void;
  /**
   * Opens a runtime over the host's store for `opener`, a live run (§9), and settles `opened`, in
   * `opener`, with the runtime `made` makes of its number, once the work it resumed ran what it had
   * due by then. Opening one while none is open resumes the instances stored there that haven't
   * ended, which run only while one is open.
   */
  readonly open: (opener: Run, opened: Future, made: (run: Run, runtime: number) => Value) => void;
  /** Closes runtime `runtime`, disposed: it serves no instance's jobs any more. */
  readonly close: (runtime: number) => void;
  /**
   * Settles `future`, in `waiter`, with the names of the instances runtime `runtime` serves the
   * jobs of (runtime.ista `_served`), once they are more than `known`.
   */
  readonly served: (waiter: Run, runtime: number, known: number, future: Future) => void;
  /** Settles `future`, in `watcher`, a watch on the instance `name`, once it has ended. */
  readonly watchEnd: (watcher: Run, name: string, future: Future) => void;
  /**
   * The newest mock of entry `index` held by an instance `caller` was spawned from, the nearest
   * holding one (§10); undefined where none does.
   */
  readonly heldMock?: (caller: Run, index: number) => HeldMock | undefined;
  /** What a test asks of the instances beside it (§10); a world running no test has none. */
  readonly testing?: TestingWorld;
}

/** How an instance is spawned: its options, and the entry encoding its outcome, if a codec does. */
export interface Spawning {
  readonly options: SpawnOptions;
  readonly encoder: number | undefined;
}

/** What a test's code asks of its world (§10, testing.ista). */
export interface TestingWorld {
  /** Where the instance `name` stands and waits; undefined before it exists. */
  readonly inspect: (name: string) => Inspection | undefined;
  /** A future, in `watcher`, that settles once the instance `name` is idle or at a waypoint. */
  readonly watch: (watcher: Run, name: string, until: TestWatch) => Value;
  /** A value of the host type entry `type` equal to no other. */
  readonly handle: (type: TypeId) => Value;
}
