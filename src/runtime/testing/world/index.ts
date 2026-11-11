/**
 * One test's world (§10): a fresh runtime, in memory, running the test in a context of its own
 * (§9) and every instance it spawns, and the seam (scheduler/testing/test-world.ts) through which
 * those reach each other.
 *
 * - Instances run one at a time, each advanced from its last commit and held in memory between
 *   (scheduler/resident.ts): what one reads of another is that one's last commit, as a host would
 *   see it. An instance calling a mock another holds runs
 *   the holder's replacement inside its own segment (scheduler/testing/mocks.ts); the answers the
 *   holder gives later are filled in once the caller's advance is over, as a host fills a future.
 *   The holder may run on meanwhile, and sees the caller neither idle nor at a waypoint, since the
 *   caller's segment hasn't committed.
 * - The world is driven as any host's instances are (runtime/testing/world/drive.ts). What it runs
 *   first is what can run now: answers to deliver, ready instances, then instances whose watches
 *   hold. When nothing can, it waits for the earliest timer on the clock it is given, real time
 *   unless the test mocked it (§10), so the runtime never sleeps. A wait past the deadline ends the
 *   test.
 * - The test is the world's call into its context, an invocation as live code's is: it ends when
 *   that call answers, or when any instance panics, which fails it at once with that panic (§10),
 *   unless an instance waits for its end (`result()`, as `expectPanic` does). Such a wait ends once it is answered, so the world remembers each panic waited for as it
 *   records it.
 *   One whose instances all wait on nothing left to wake them fails, naming where each waits.
 * - An extern no mock replaces panics the instance calling it: a test's only host is its mocks.
 */

import type { Definition } from '../../../definition/definition.ts';
import type { FunctionId } from '../../../definition/operands.ts';
import type { Value } from '../../../definition/values/values.ts';
import { jobWaypoint } from '../../../foundation/language/well-known/jobs.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Clock } from '../../clock.ts';
import { InstanceGroup } from '../../host/instance-group.ts';
import type { Inspection, LogRecord } from '../../instance-state.ts';
import type { Natives } from '../../natives.ts';
import { inspection } from '../../scheduler/inspect.ts';
import type { Answered } from '../../scheduler/instance/futures.ts';
import { storedSnapshot } from '../../scheduler/instance/instance-ends.ts';
import { type LoadedDefinition, loadDefinition } from '../../scheduler/loaded-definition.ts';
import { Resident } from '../../scheduler/resident.ts';
import type { MockAnswer, MockCall, TestWorld } from '../../scheduler/testing/test-world.ts';
import {
  type Advance,
  type AdvanceFirst,
  advance,
  newContext,
  type SchedulerSeams,
} from '../../scheduler/wake.ts';
import type { TestWatch } from '../../snapshot/objects.ts';
import type { InstanceCall, Snapshot } from '../../snapshot/snapshot.ts';
import { memoryStore } from '../../store.ts';
import { drive } from './drive.ts';
import { pendingTestWatches, withdrawnAnswers } from './snapshot-reads.ts';
import { unmockedExterns } from './test-host.ts';

/** A failed test: why, where, and the log records its instances committed, in order (§10). */
export interface Failed {
  readonly kind: 'failed';
  readonly message: string;
  readonly trace: string;
  readonly logs: readonly LogRecord[];
}

/** How a test's instance ended: finished with its outcome, or failed. */
export type Ended = { readonly kind: 'finished'; readonly outcome: Value } | Failed;

/**
 * What a world is given: the program, the runtime's natives, its clock, the seed of its test's
 * random source and how long it may run.
 */
export interface WorldSeams {
  readonly definition: Definition;
  readonly hash: string;
  readonly natives: Natives;
  readonly clock: Clock;
  /** The seed of the test's instance's random source (§3.8 `random`, random.ts). */
  readonly seed: string;
  /** When the test must have ended, in milliseconds since the Unix epoch. */
  readonly deadline: bigint;
}

/** The key of the test's own context; the instances it spawns are named after it. */
const testInstance = 'test';

/** The token naming the world's call into the test's context, whose answer is the test's end. */
const testCall = 'test';

/** An answer to another instance's call to a mock, which the world delivers to it. */
type Arrival = Answered & { readonly instance: string };

const allowTest = (): void => undefined;

export class World implements TestWorld {
  readonly #seams: SchedulerSeams;
  readonly #clock: Clock;
  readonly #loaded: LoadedDefinition;
  /** Every instance of the world, at its last commit; one spawned joins it from the store. */
  readonly #residents = new Map<string, Resident>();
  readonly #deadline: bigint;
  readonly #seed: string;
  readonly #group = new InstanceGroup();
  readonly #arrivals: Arrival[] = [];
  /** What the call into the test's context gave, once it answered. */
  #outcome: { readonly value: Value } | undefined;
  /** The log records every instance of the world committed, in the order they did. */
  readonly #logs: LogRecord[] = [];
  readonly #mocks = new WeakMap<Snapshot, ReadonlyMap<FunctionId, number>>();
  /** The instances in a segment that waits on a mock another instance is answering. */
  readonly #calling = new Set<string>();
  /** The instances whose panic some instance waited for, which therefore fails no test. */
  readonly #expectedPanics = new Set<string>();
  #handles = 0;

  constructor({ definition, hash, natives, clock, seed, deadline }: WorldSeams) {
    this.#seams = { store: memoryStore(), now: clock.now };
    this.#clock = clock;
    this.#deadline = deadline;
    this.#seed = seed;
    this.#loaded = loadDefinition(
      definition,
      hash,
      { ...natives, ...unmockedExterns(definition, natives) },
      this,
    );
  }

  /**
   * Runs `call` in the test's own context (§9), with what it starts and spawns, until the call
   * answers or something panics.
   */
  async run(call: InstanceCall): Promise<Ended> {
    const test = new Resident(
      this.#loaded,
      newContext(this.#loaded, testInstance, { seed: this.#seed }),
    );
    this.#residents.set(testInstance, test);
    const invocation = { call, token: testCall };
    this.#record(testInstance, advance(this.#seams, test, { kind: 'invocation', invocation }));
    const driven = await drive({
      group: this.#group,
      now: this.#clock.now,
      runNext: () => Promise.resolve(this.#step()),
      wake: (instance) => Promise.resolve(this.#advance(instance)),
      wait: async (due) => {
        if (due !== undefined) {
          await this.#clock.until(due);
        }
        return false;
      },
      ends: () => this.#ended() !== undefined,
      deadline: this.#deadline,
    });
    switch (driven) {
      case 'ended':
        return this.#ended() ?? unreachable('The test ended.');
      case 'late':
        return this.#failure('The test waits past its timeout');
      case 'settled':
        return this.#failure('The test waits on nothing that can wake it');
      default: {
        const unhandled: never = driven;
        return unhandled;
      }
    }
  }

  mockOf(holder: string, target: FunctionId): number | undefined {
    const snapshot = this.#snapshotOf(holder);
    return snapshot === undefined ? undefined : mocksOf(this.#mocks, snapshot).get(target);
  }

  answer(holder: string, call: MockCall): MockAnswer {
    const resident = this.#resident(holder);
    if (resident?.committed.status.kind !== 'active') {
      return { kind: 'failed' };
    }
    this.#calling.add(call.instance);
    let advanced: Advance;
    try {
      advanced = advance(this.#seams, resident, { kind: 'answer', call });
    } finally {
      this.#calling.delete(call.instance);
    }
    const given = advanced.answered.find(
      ({ instance, token }) => instance === call.instance && token === call.token,
    );
    this.#record(holder, {
      ...advanced,
      answered: advanced.answered.filter((answered) => answered !== given),
    });
    if (given !== undefined) {
      return { kind: 'given', value: given.value, followed: given.followed };
    }
    return advanced.state.kind === 'panicked' ? { kind: 'failed' } : { kind: 'pending' };
  }

  readonly watched = (instance: string, until: TestWatch): Value | undefined => {
    const snapshot = this.#snapshotOf(instance);
    const status = snapshot?.status.kind;
    // A segment of the instance running on has done more than its last commit says.
    const settled = !this.#calling.has(instance);
    switch (until.kind) {
      case 'idle':
        return settled && (status === 'active' || status === 'finished') ? null : undefined;
      case 'waypoint': {
        const { label } = until;
        const waits =
          settled &&
          snapshot !== undefined &&
          status === 'active' &&
          inspection(this.#loaded.definition, snapshot).waitingAt.some(
            ({ waypoint }) => waypoint === label,
          );
        return waits ? null : undefined;
      }
      default: {
        const unhandled: never = until;
        return unhandled;
      }
    }
  };

  readonly requireTest = allowTest;

  inspect(instance: string): Inspection | undefined {
    const snapshot = this.#snapshotOf(instance);
    return snapshot === undefined ? undefined : inspection(this.#loaded.definition, snapshot);
  }

  handlePayload(): string {
    this.#handles += 1;
    return `testing.handle/${this.#handles}`;
  }

  /** Runs one thing that can run now: an answer to deliver, a ready instance, a watch that holds. */
  #step(): boolean {
    const arrival = this.#arrivals.shift();
    if (arrival !== undefined) {
      this.#advance(arrival.instance, { kind: 'arrival', arrival });
      return true;
    }
    const ready = this.#group.ready();
    if (ready !== undefined) {
      this.#advance(ready);
      return true;
    }
    const watching = [...this.#group.states.keys()].find((instance) => this.#watchHolds(instance));
    if (watching !== undefined) {
      this.#advance(watching);
      return true;
    }
    return false;
  }

  /** Advances `instance` from its last commit, starting with `first`. */
  #advance(instance: string, first?: AdvanceFirst): void {
    const resident = this.#resident(instance);
    if (resident !== undefined) {
      this.#record(instance, advance(this.#seams, resident, first));
    }
  }

  #record(instance: string, advanced: Advance): void {
    this.#group.record(instance, advanced);
    for (const answered of advanced.answered) {
      if (answered.instance !== undefined) {
        this.#arrivals.push({ ...answered, instance: answered.instance });
      } else if (answered.token === testCall) {
        this.#outcome = { value: answered.value };
      }
    }
    this.#logs.push(...advanced.logs);
    this.#withdrawAnswersTo(instance);
    if (advanced.state.kind === 'panicked' && this.#waitsForPanicOf(instance)) {
      this.#expectedPanics.add(instance);
    }
  }

  /**
   * Has every holder drop its answers to the calls of `caller` whose futures `caller` let go of,
   * as a host frees the token of a disposed future (§7), so a mocked receive that lost a `select`
   * takes nothing (§6).
   */
  #withdrawAnswersTo(caller: string): void {
    const callerSnapshot = this.#snapshotOf(caller);
    // A holder in a segment waiting on an answer has run past its last commit, so is left alone.
    const holders = [...this.#group.states.keys()].filter((holder) => !this.#calling.has(holder));
    for (const holder of holders) {
      const withdrawn = withdrawnAnswers(this.#snapshotOf(holder), caller, callerSnapshot);
      if (withdrawn.length > 0) {
        this.#advance(holder, { kind: 'withdraw', withdrawn });
      }
    }
  }

  /** Whether some instance waits for `instance`'s end, so its panic is that wait's to handle. */
  #waitsForPanicOf(instance: string): boolean {
    return [...this.#group.states.values()].some(
      (state) => state.kind === 'waiting' && state.watching.includes(instance),
    );
  }

  /** How the test ended, if it has: its instance finished, or some instance panicked. */
  #ended(): Ended | undefined {
    for (const [instance, state] of this.#group.states) {
      if (state.kind === 'panicked' && !this.#expectedPanics.has(instance)) {
        const message =
          instance === testInstance
            ? state.message
            : `Instance ${instance} panicked: ${state.message}`;
        return { kind: 'failed', message, trace: state.trace, logs: this.#logs };
      }
    }
    return this.#outcome === undefined
      ? undefined
      : { kind: 'finished', outcome: this.#outcome.value };
  }

  /**
   * A failure saying `why`, and where each instance still waits; one waiting on a job is told no
   * runtime serves jobs in a test, so the test mocks the ista function delegating it (§10).
   */
  #failure(why: string): Ended {
    const waits = [...this.#group.states.keys()].flatMap((instance) =>
      (this.inspect(instance)?.waitingAt ?? []).map((wait) => ({ instance, ...wait })),
    );
    const listed = waits.map(
      ({ instance, waypoint, location }) =>
        `${instance} at ${waypoint === undefined ? location : `${waypoint} (${location})`}`,
    );
    const onJob = waits.some(({ waypoint }) => waypoint === jobWaypoint)
      ? ' A job runtime.delegate queued waits for a runtime to serve it, which a test has none of: mock the ista function delegating it.'
      : '';
    return {
      kind: 'failed',
      message: `${why}: ${listed.join(', ')}.${onJob}`,
      trace: '',
      logs: this.#logs,
    };
  }

  /** Whether `instance` waits, with a watch whose condition now holds. */
  #watchHolds(instance: string): boolean {
    return pendingTestWatches(this.#snapshotOf(instance)).some(
      ({ instance: target, until }) => this.watched(target, until) !== undefined,
    );
  }

  /** `instance`'s last commit; undefined before its first. */
  #snapshotOf(instance: string): Snapshot | undefined {
    return this.#resident(instance)?.committed;
  }

  /** `instance`, held since it joined the world; one spawned joins it from the store. */
  #resident(instance: string): Resident | undefined {
    const held = this.#residents.get(instance);
    if (held !== undefined) {
      return held;
    }
    const stored = storedSnapshot(this.#seams.store, instance);
    if (stored === undefined) {
      return undefined;
    }
    const resident = new Resident(this.#loaded, stored);
    this.#residents.set(instance, resident);
    return resident;
  }
}

/**
 * The mock each target's calls reach in `snapshot`, memoized on it: its newest, which is its last,
 * since a snapshot's objects ascend by id.
 */
function mocksOf(
  memory: WeakMap<Snapshot, ReadonlyMap<FunctionId, number>>,
  snapshot: Snapshot,
): ReadonlyMap<FunctionId, number> {
  return memo(
    memory,
    snapshot,
    () =>
      new Map(
        snapshot.objects.flatMap((object) =>
          object.kind === 'mock' ? [[object.target, object.id] as const] : [],
        ),
      ),
  );
}
