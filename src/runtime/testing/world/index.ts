/**
 * One test's world (§10): a fresh runtime, in memory, running the test's instance and every
 * instance it starts or spawns, and the seam (scheduler/test-world.ts) through which those reach
 * each other.
 *
 * - Instances run one at a time, each advanced from its last commit: what one reads of another is
 *   that one's last commit, as a host would see it. An instance calling a mock another holds runs
 *   the holder's replacement inside its own segment (scheduler/mocks.ts); the answers the holder
 *   gives later are filled in once the caller's advance is over, as a host fills a future. The
 *   holder may run on meanwhile, and sees the caller neither idle nor at a waypoint, since the
 *   caller's segment hasn't committed.
 * - Each pass runs what can run now: answers to deliver, ready instances, then instances whose
 *   watches hold. When nothing can, the world waits for the earliest timer, on real time unless
 *   the test mocked it (§10), and that wait is the caller's to make, as `settle` leaves it
 *   (runtime/settle.ts), so the runtime never sleeps. A wait past the deadline ends the test.
 * - The test ends when its own instance finishes, or when any instance panics, which fails it at
 *   once with that panic (§10), unless an instance waits for its end (`result()`, as `expectPanic`
 *   does). Such a wait ends once it is answered, so the world remembers each panic waited for as it
 *   records it.
 *   One whose instances all wait on nothing left to wake them fails, naming where each waits.
 * - An extern no mock replaces panics the instance calling it: a test's only host is its mocks.
 */

import type { Definition } from '../../../definition/definition.ts';
import type { FunctionId } from '../../../definition/operands.ts';
import type { Value } from '../../../definition/values.ts';
import { memo } from '../../../structures/memo.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { InstanceGroup } from '../../instance-group.ts';
import type { Inspection, LogRecord } from '../../instance-state.ts';
import type { Natives } from '../../natives.ts';
import type { Answered } from '../../scheduler/futures.ts';
import { inspection, pendingTestWatches, withdrawnAnswers } from '../../scheduler/inspect.ts';
import { storedSnapshot } from '../../scheduler/instance-ends.ts';
import { type LoadedDefinition, loadDefinition } from '../../scheduler/loaded-definition.ts';
import { reachingMock } from '../../scheduler/mocks.ts';
import type { MockAnswer, MockCall, TestWorld } from '../../scheduler/test-world.ts';
import {
  type Advance,
  type AdvanceFirst,
  advance,
  type SchedulerSeams,
  unstarted,
} from '../../scheduler/wake.ts';
import type { TestWatch } from '../../snapshot/objects.ts';
import type { InstanceCall, Snapshot } from '../../snapshot/snapshot.ts';
import { memoryStore } from '../../store.ts';
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
  /** Milliseconds since the Unix epoch. */
  readonly now: () => bigint;
  /** The seed of the test's instance's random source (§3.8 `random`, random-seed.ts). */
  readonly seed: string;
  /** When the test must have ended, in milliseconds since the Unix epoch. */
  readonly deadline: bigint;
}

/** What the test's own instance is named; the instances it starts are named after it. */
const testInstance = 'test';

export class World implements TestWorld {
  readonly #seams: SchedulerSeams;
  readonly #loaded: LoadedDefinition;
  readonly #deadline: bigint;
  readonly #seed: string;
  readonly #group = new InstanceGroup();
  readonly #arrivals: Answered[] = [];
  /** The log records every instance of the world committed, in the order they did. */
  readonly #logs: LogRecord[] = [];
  readonly #mocks = new WeakMap<Snapshot, ReadonlyMap<FunctionId, number>>();
  /** The instances in a segment that waits on a mock another instance is answering. */
  readonly #calling = new Set<string>();
  /** The instances whose panic some instance waited for, which therefore fails no test. */
  readonly #expectedPanics = new Set<string>();
  #handles = 0;

  constructor({ definition, hash, natives, now, seed, deadline }: WorldSeams) {
    this.#seams = { store: memoryStore(), now };
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
   * Runs `call` as the test's instance, with what it starts and spawns, until it ends: yields each
   * time everything waits on a timer, the time to wait until, and is resumed once it is due.
   */
  *run(call: InstanceCall): Generator<bigint, Ended, undefined> {
    this.#record(
      testInstance,
      advance(
        this.#seams,
        this.#loaded,
        unstarted(this.#loaded, testInstance, call, { seed: this.#seed }),
      ),
    );
    for (let ended = this.#ended(); ended === undefined; ended = this.#ended()) {
      if (!this.#step()) {
        const due = this.#group.earliestTimer();
        if (due === undefined) {
          return this.#failure('The test waits on nothing that can wake it');
        }
        if (due > this.#deadline) {
          return this.#failure('The test waits past its timeout');
        }
        if (due > this.#seams.now()) {
          yield due;
        }
        this.#wakeDue();
      }
    }
    return this.#ended() ?? unreachable('The test ended.');
  }

  mockOf(holder: string, target: FunctionId): number | undefined {
    const snapshot = this.#snapshotOf(holder);
    return snapshot === undefined ? undefined : mocksOf(this.#mocks, snapshot).get(target);
  }

  answer(holder: string, call: MockCall): MockAnswer {
    const snapshot = this.#snapshotOf(holder);
    if (snapshot?.status.kind !== 'active') {
      return { kind: 'failed' };
    }
    this.#calling.add(call.instance);
    let advanced: Advance;
    try {
      advanced = advance(this.#seams, this.#loaded, snapshot, { kind: 'answer', call });
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
    const snapshot = this.#snapshotOf(instance);
    if (snapshot !== undefined) {
      this.#record(instance, advance(this.#seams, this.#loaded, snapshot, first));
    }
  }

  /** Wakes every instance whose next timer is due now. */
  #wakeDue(): void {
    for (const instance of this.#group.dueBy(this.#seams.now())) {
      this.#advance(instance);
    }
  }

  #record(instance: string, advanced: Advance): void {
    this.#group.record(instance, advanced);
    this.#arrivals.push(...advanced.answered);
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
    const own = this.#group.states.get(testInstance);
    return own?.kind === 'finished' ? { kind: 'finished', outcome: own.outcome } : undefined;
  }

  /** A failure saying `why`, and where each instance still waits. */
  #failure(why: string): Ended {
    const waits = [...this.#group.states.keys()].flatMap((instance) =>
      (this.inspect(instance)?.waitingAt ?? []).map(
        ({ waypoint, location }) =>
          `${instance} at ${waypoint === undefined ? location : `${waypoint} (${location})`}`,
      ),
    );
    return { kind: 'failed', message: `${why}: ${waits.join(', ')}.`, trace: '', logs: this.#logs };
  }

  /** Whether `instance` waits, with a watch whose condition now holds. */
  #watchHolds(instance: string): boolean {
    return pendingTestWatches(this.#snapshotOf(instance)).some(
      ({ instance: target, until }) => this.watched(target, until) !== undefined,
    );
  }

  /** `instance`'s last commit; undefined before its first. Read once per commit. */
  #snapshotOf(instance: string): Snapshot | undefined {
    return storedSnapshot(this.#seams.store, instance);
  }
}

/** The mock each target's calls reach in `snapshot`, memoized on it. */
function mocksOf(
  memory: WeakMap<Snapshot, ReadonlyMap<FunctionId, number>>,
  snapshot: Snapshot,
): ReadonlyMap<FunctionId, number> {
  return memo(memory, snapshot, () => {
    const byTarget = new Map<FunctionId, { readonly id: number }[]>();
    for (const object of snapshot.objects) {
      if (object.kind === 'mock') {
        byTarget.set(object.target, [...(byTarget.get(object.target) ?? []), object]);
      }
    }
    return new Map(
      [...byTarget].flatMap(([target, mocks]) => {
        const reached = reachingMock(mocks);
        return reached === undefined ? [] : [[target, reached.id]];
      }),
    );
  });
}
