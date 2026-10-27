/**
 * One test's world (§10): a fresh runtime, in memory, running the test's instance and every
 * instance it starts or spawns, and the seam (scheduler/test-world.ts) through which those reach
 * each other.
 *
 * - Instances run one at a time, each advanced from its last commit: what one reads of another is
 *   that one's last commit, as a host would see it. An instance calling a mock another holds runs
 *   the holder's replacement inside its own segment (scheduler/mocks.ts); the answers the holder
 *   gives later are filled in once the caller's advance is over, as a host fills a future.
 * - Each pass runs what can run now: answers to deliver, ready instances, then instances whose
 *   watches hold. When nothing can, the world waits for the earliest timer, on real time unless
 *   the test mocked it (§10), and that wait is the caller's to make, as `settle` leaves it
 *   (runtime/settle.ts), so the runtime never sleeps. A wait past the deadline ends the test.
 * - The test ends when its own instance finishes, or when any instance panics, which fails it at
 *   once with that panic (§10). One whose instances all wait on nothing left to wake them fails,
 *   naming where each waits.
 * - An extern no mock replaces panics the instance calling it: a test's only host is its mocks.
 */

import type { Definition } from '../../definition/definition.ts';
import { jsonOfPlain, jsonTypeOf } from '../../definition/json-values.ts';
import type { FunctionId } from '../../definition/operands.ts';
import type { Value } from '../../definition/values.ts';
import { memo } from '../../structures/memo.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { InstanceGroup } from '../instance-group.ts';
import { type Native, type Natives, Panic } from '../natives.ts';
import type { Answered, Watch } from '../scheduler/futures.ts';
import { type Inspection, inspection } from '../scheduler/inspect.ts';
import { type LoadedDefinition, loadDefinition } from '../scheduler/loaded-definition.ts';
import { reachingMock } from '../scheduler/mocks.ts';
import type { MockAnswer, MockCall, TestWorld } from '../scheduler/test-world.ts';
import {
  type Advance,
  type AdvanceFirst,
  advance,
  type SchedulerSeams,
  unstarted,
} from '../scheduler/wake.ts';
import { type InstanceCall, type Snapshot, snapshotFormat } from '../snapshot/snapshot.ts';
import { memoryStore } from '../store.ts';

/** How a test's instance ended: finished with its outcome, or failed. */
export type Ended =
  | { readonly kind: 'finished'; readonly outcome: Value }
  | { readonly kind: 'failed'; readonly message: string; readonly trace: string };

/** What a world is given: the program, the runtime's natives, its clock and how long it may run. */
export interface WorldSeams {
  readonly definition: Definition;
  readonly hash: string;
  readonly natives: Natives;
  /** Milliseconds since the Unix epoch. */
  readonly now: () => bigint;
  /** When the test must have ended, in milliseconds since the Unix epoch. */
  readonly deadline: bigint;
}

/** What the test's own instance is named; the instances it starts are named after it. */
const testInstance = 'test';

export class World implements TestWorld {
  readonly #seams: SchedulerSeams;
  readonly #loaded: LoadedDefinition;
  readonly #deadline: bigint;
  readonly #group = new InstanceGroup();
  readonly #arrivals: Answered[] = [];
  readonly #read = new Map<string, { readonly text: string; readonly snapshot: Snapshot }>();
  readonly #mocks = new WeakMap<Snapshot, ReadonlyMap<FunctionId, number>>();
  #handles = 0;

  constructor({ definition, hash, natives, now, deadline }: WorldSeams) {
    this.#seams = { store: memoryStore(), now };
    this.#deadline = deadline;
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
      advance(this.#seams, this.#loaded, unstarted(this.#loaded, testInstance, call, {})),
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
    const advanced = advance(this.#seams, this.#loaded, snapshot, { answering: call });
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

  readonly watched = (watch: Watch): Value | undefined => {
    const snapshot = this.#snapshotOf(watch.instance);
    const status = snapshot?.status.kind;
    switch (watch.until.kind) {
      case 'idle':
        return status === 'active' || status === 'finished' ? null : undefined;
      case 'finished':
        return snapshot?.status.kind === 'finished' ? snapshot.status.outcome : undefined;
      case 'waypoint': {
        const { label } = watch.until;
        const waits =
          snapshot !== undefined &&
          status === 'active' &&
          inspection(this.#loaded.definition, snapshot).waitingAt.some(
            ({ waypoint }) => waypoint === label,
          );
        return waits ? null : undefined;
      }
      default: {
        const unhandled: never = watch.until;
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
      this.#advance(arrival.instance, { arrival });
      return true;
    }
    const ready = this.#group.ready();
    if (ready !== undefined) {
      this.#advance(ready, {});
      return true;
    }
    const watching = [...this.#group.states.keys()].find((instance) => this.#watchHolds(instance));
    if (watching !== undefined) {
      this.#advance(watching, {});
      return true;
    }
    return false;
  }

  /** Advances `instance` from its last commit, filling `arrival` first. */
  #advance(instance: string, first: AdvanceFirst): void {
    const snapshot = this.#snapshotOf(instance);
    if (snapshot !== undefined) {
      this.#record(instance, advance(this.#seams, this.#loaded, snapshot, first));
    }
  }

  /** Wakes every instance whose next timer is due now. */
  #wakeDue(): void {
    for (const instance of this.#group.dueBy(this.#seams.now())) {
      this.#advance(instance, {});
    }
  }

  #record(instance: string, advanced: Advance): void {
    this.#group.record(instance, advanced);
    this.#arrivals.push(...advanced.answered);
  }

  /** How the test ended, if it has: its instance finished, or some instance panicked. */
  #ended(): Ended | undefined {
    for (const [instance, state] of this.#group.states) {
      if (state.kind === 'panicked') {
        const message =
          instance === testInstance
            ? state.message
            : `Instance ${instance} panicked: ${state.message}`;
        return { kind: 'failed', message, trace: state.trace };
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
    return { kind: 'failed', message: `${why}: ${waits.join(', ')}.`, trace: '' };
  }

  /** Whether `instance` waits, with a watch whose condition now holds. */
  #watchHolds(instance: string): boolean {
    const snapshot = this.#snapshotOf(instance);
    return (
      snapshot?.status.kind === 'active' &&
      snapshot.objects.some(
        (object) =>
          object.kind === 'future' &&
          object.state.kind === 'watch' &&
          this.watched(object.state) !== undefined,
      )
    );
  }

  /** `instance`'s last commit; undefined before its first. Read once per commit. */
  #snapshotOf(instance: string): Snapshot | undefined {
    const text = this.#seams.store.readSnapshot(instance);
    if (text === undefined) {
      return undefined;
    }
    const known = this.#read.get(instance);
    if (known?.text === text) {
      return known.snapshot;
    }
    const snapshot = snapshotFormat.read(text);
    this.#read.set(instance, { text, snapshot });
    return snapshot;
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

/**
 * A test's host (§10), for each extern of `definition` the runtime's `natives` lack: one no mock
 * replaces panics, except a host type's `dispose`, the native its type entry names
 * (definition/types.ts), which does nothing, since the test has nothing of its host's to release,
 * and gives back the JSON `null` a host's function returning nothing gives (§9).
 */
function unmockedExterns(definition: Definition, natives: Natives): Natives {
  const releasing = new Set(
    definition.types.flatMap((entry) =>
      entry.kind === 'extern' &&
      entry.disposal.kind === 'function' &&
      entry.disposal.host !== undefined
        ? [entry.disposal.host]
        : [],
    ),
  );
  const nothing: Native = () => jsonOfPlain(null, jsonTypeOf(definition.types));
  return Object.fromEntries(
    definition.functions.flatMap((entry, index) => {
      if (entry.kind !== 'extern' || Object.hasOwn(natives, entry.key)) {
        return [];
      }
      const native = releasing.has(index) ? nothing : unmocked(entry.name);
      return [[entry.key, native]];
    }),
  );
}

/** The native of the extern `name` in a test no mock replaced: calling it panics. */
function unmocked(name: string): Native {
  return () => {
    throw new Panic(`No mock replaces ${name}, which a test's host would implement.`);
  };
}
