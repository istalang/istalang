/**
 * An ista instance of a host's world, resident in memory while the world holds it (§5): its run,
 * the snapshot it last committed, and what its segment since then did, which leaves it only at its
 * next commit (commits.ts).
 */

import type { EmittedProgram } from '../../codegen/emit.ts';
import type { KeyedDefinition } from '../../definition/definition.ts';
import { copied } from '../../definition/values/replacing.ts';
import type { Value } from '../../definition/values/values.ts';
import type { LogRecord } from '../instance-state.ts';
import type { InstanceEnd, InvocationEnd } from '../run/instances.ts';
import { hearsNothing, type Invocation } from '../run/invocations.ts';
import type { Run } from '../run/run.ts';
import type { PersistedStatus, Replay, Snapshot } from '../snapshot/format.ts';
import { rootInvocation } from '../snapshot/restore.ts';

/** The program a world runs: its Definition, the hash the store keys it by, its emitted code. */
export interface WorldProgram extends KeyedDefinition {
  readonly emitted: EmittedProgram;
}

/** What makes a resident: its name, its program, the seed of its random source, its status. */
export interface ResidentMade {
  readonly name: string;
  readonly program: WorldProgram;
  /** A host's for one it starts, a draw of its parent's for one spawned. */
  readonly seed: Uint8Array;
  /** The instances it was spawned from, nearest first; none for a context. */
  readonly lineage?: readonly string[];
  /** Where one read back from the store stands; a new one is active. */
  readonly status?: PersistedStatus;
}

/** Something waking a segment, applied to the run; a rerun applies it again. */
export type Input = (run: Run) => void;

export class Resident {
  readonly name: string;
  readonly program: WorldProgram;
  readonly seed: Uint8Array;
  /** The instances it was spawned from, nearest first (§9). */
  readonly lineage: readonly string[];
  crashEveryAwait: boolean;
  /** The entry encoding its outcome, a spawned instance's whose type a codec writes (§9). */
  encoder: number | undefined;
  /** Whether its panic terminates it at once, as an isolated instance's does (§9). */
  terminatesOnPanic = false;
  status: PersistedStatus;
  run: Run;
  /**
   * The snapshot it last committed, if it ever did, as read: the store's text is written once, and
   * never read back while it is resident.
   */
  committed: Snapshot | undefined;
  /** Whether it was spawned and hasn't run yet. */
  unstarted: boolean;
  /** What woke its segment, since its last commit. */
  inputs: Input[] = [];
  /**
   * The call that started its segment since its last commit, which a retry of that segment runs
   * again (§3.12); none for a segment a timer or another instance started.
   */
  replay: Replay | undefined;
  /** When its segment started: the time its clock reads all segment long. */
  startedAt = 0n;
  /**
   * What leaves it at its next commit: what its segment did to others and its log records, which a
   * failed segment never did (§5), and what its end tells the calls still waiting on it, which leaves
   * it all the same.
   */
  effects: (() => void)[] = [];
  logs: LogRecord[] = [];
  endings: (() => void)[] = [];
  /** Where its log records go while a host advances it itself, rather than to the host's reports. */
  heardBy: ((records: readonly LogRecord[]) => void) | undefined;
  /** The answers of the calls into it running as it last committed, by their futures' ids. */
  answers = new Map<number, Invocation>();
  /** What waits on its end, told as it commits one (§9). */
  readonly endWatchers: ((end: InstanceEnd) => void)[] = [];
  /** The instances it spawned in the segment committing next. */
  spawned: string[] = [];

  constructor(
    { name, program, seed, lineage = [], status = { kind: 'active' } }: ResidentMade,
    crashEveryAwait: boolean,
    runOf: (resident: Resident) => Run,
  ) {
    this.name = name;
    this.program = program;
    this.seed = seed;
    this.lineage = lineage;
    this.status = status;
    this.crashEveryAwait = crashEveryAwait;
    this.encoder = undefined;
    this.unstarted = false;
    this.run = runOf(this);
  }

  /** Whether its instance has ended: finished, panicked or terminated. */
  get ended(): boolean {
    return this.status.kind !== 'active';
  }

  /**
   * Applies `input` to its run, starting its segment at `at` if none is going, which `replay` runs
   * again if it is a call.
   */
  feed(input: Input, at: bigint, replay?: Replay): void {
    if (this.inputs.length === 0) {
      this.startedAt = at;
      this.replay = replay;
    }
    this.inputs.push(input);
    input(this.run);
  }

  /** Starts a segment at `at` firing its timers due by then, if any are; whether any were. */
  wake(at: bigint): boolean {
    const due = this.run.timers.next();
    if (due === undefined || due > at) {
      return false;
    }
    this.feed((run) => run.fireDue(at), at);
    return true;
  }

  /** The input starting the call it was spawned to run, which its end is what that gives. */
  starting(closure: Value): Input {
    return (run) => {
      run.invoke(copied(closure), [], rootInvocation(run, this.encoder));
    };
  }

  /**
   * The input running `replay` again: a call into it answers nobody, its caller told of the panic,
   * which a panic again is the host's to hear.
   */
  replayed(replay: Replay): Input {
    if (replay.kind === 'start') {
      return this.starting(replay.call);
    }
    const { call: closure, passed } = replay;
    return invoking({ closure, passed, hears: hearsNothing }, () => undefined);
  }

  /** How it ended, as what waits on its end is told; undefined while it runs. */
  get end(): InstanceEnd | undefined {
    return endOf(this.status);
  }
}

/**
 * A call into an instance: the closure it calls and what it passes, and whether its caller hears
 * the instance's panic: not once it let go of the call, and never the loop serving jobs, which
 * leaves it to the host (§9).
 */
export interface CallInto {
  readonly closure: Value;
  readonly passed: readonly Value[];
  readonly hears: () => boolean;
}

/** The input starting `call` in an instance, `answer` told how it ended. */
export function invoking(call: CallInto, answer: (end: InvocationEnd) => void): Input {
  const { closure, passed, hears } = call;
  return (run) => run.invoke(copied(closure), passed.map(copied), { answer, root: false, hears });
}

/** How an instance in `status` ended; undefined while it runs. */
function endOf(status: PersistedStatus): InstanceEnd | undefined {
  switch (status.kind) {
    case 'finished':
      return {
        kind: 'finished',
        outcome: status.outcome,
        ...(status.encoded === undefined ? {} : { encoded: status.encoded }),
      };
    case 'panicked':
    case 'terminated':
      return { kind: 'panicked', message: status.message, trace: status.trace };
    case 'active':
      return undefined;
    default: {
      const unhandled: never = status;
      return unhandled;
    }
  }
}

/**
 * Which of `residents` runs next: the one whose waiting turn arrived first among every run's, so
 * what settles first runs first, whichever instance waits on it (§6); else the first made.
 */
export function firstArrived(residents: ReadonlySet<Resident>): Resident | undefined {
  let first: Resident | undefined;
  for (const resident of residents) {
    const at = resident.run.arrivals.first;
    const firstAt = first?.run.arrivals.first;
    if (first === undefined || (at !== undefined && (firstAt === undefined || at < firstAt))) {
      first = resident;
    }
  }
  return first;
}
