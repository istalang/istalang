/**
 * An ista instance of a host's world, resident in memory while the world holds it (§5): its run,
 * the snapshot it last committed, and what its segment since then did, which leaves it only at its
 * next commit (commits.ts).
 */

import type { EmittedProgram } from '../../codegen/emit.ts';
import type { Definition } from '../../definition/definition.ts';
import { copied } from '../../definition/values/replacing.ts';
import type { Value } from '../../definition/values/values.ts';
import type { LogRecord } from '../instance-state.ts';
import type { InstanceEnd } from '../run/instances.ts';
import type { Invocation } from '../run/invocations.ts';
import type { Run } from '../run/run.ts';
import type { PersistedStatus } from '../snapshot/format.ts';
import { rootInvocation } from '../snapshot/restore.ts';

/** The program a world runs: its Definition, the hash the store keys it by, its emitted code. */
export interface WorldProgram {
  readonly definition: Definition;
  readonly hash: string;
  readonly emitted: EmittedProgram;
}

/** What makes a resident: its name, its program, and the seed of its random source. */
export interface ResidentMade {
  readonly name: string;
  readonly program: WorldProgram;
  /** A host's for one it starts, a draw of its parent's for one spawned. */
  readonly seed: Uint8Array;
}

/** Something waking a segment, applied to the run; a rerun applies it again. */
export type Input = (run: Run) => void;

export class Resident {
  readonly name: string;
  readonly program: WorldProgram;
  readonly seed: Uint8Array;
  crashEveryAwait: boolean;
  /** The entry encoding its outcome, a spawned instance's whose type a codec writes (§9). */
  encoder: number | undefined;
  status: PersistedStatus = { kind: 'active' };
  run: Run;
  /** The snapshot it last committed, if it ever did. */
  text: string | undefined;
  /** Whether it was spawned and hasn't run yet. */
  unstarted: boolean;
  /** What woke its segment, since its last commit. */
  inputs: Input[] = [];
  /** The call starting it, which a retry of its failed first segment runs again (§3.12). */
  replay: Value | undefined;
  /** When its segment started: the time its clock reads all segment long. */
  startedAt = 0n;
  /** What leaves it at its next commit: what it did to others, and its log records. */
  effects: (() => void)[] = [];
  logs: LogRecord[] = [];
  /** Where its log records go while a host advances it itself, rather than to the host's reports. */
  heardBy: ((records: readonly LogRecord[]) => void) | undefined;
  /** The answers of the calls into it running as it last committed, by their futures' ids. */
  answers = new Map<number, Invocation>();
  /** What waits on its end, told as it commits one (§9). */
  readonly endWatchers: ((end: InstanceEnd) => void)[] = [];
  /** The instances it spawned in the segment committing next. */
  spawned: string[] = [];

  constructor(
    { name, program, seed }: ResidentMade,
    crashEveryAwait: boolean,
    runOf: (resident: Resident) => Run,
  ) {
    this.name = name;
    this.program = program;
    this.seed = seed;
    this.crashEveryAwait = crashEveryAwait;
    this.encoder = undefined;
    this.unstarted = false;
    this.run = runOf(this);
  }

  /** Whether its instance has ended: finished, panicked or terminated. */
  get ended(): boolean {
    return this.status.kind !== 'active';
  }

  /** Applies `input` to its run, starting its segment at `at` if none is going. */
  feed(input: Input, at: bigint): void {
    if (this.inputs.length === 0) {
      this.startedAt = at;
    }
    this.inputs.push(input);
    input(this.run);
  }

  /** Starts a segment at `at` firing its timers due by then, if any are. */
  wake(at: bigint): void {
    const due = this.run.timers.next();
    if (due !== undefined && due <= at) {
      this.feed((run) => run.fireDue(at), at);
    }
  }

  /** The input starting the call it was spawned to run, which its end is what that gives. */
  starting(closure: Value): Input {
    return (run) => {
      run.invoke(copied(closure), rootInvocation(run, this.encoder).answer, { root: true });
      this.replay = closure;
    };
  }

  /** How it ended, as what waits on its end is told; undefined while it runs. */
  get end(): InstanceEnd | undefined {
    return endOf(this.status);
  }
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
