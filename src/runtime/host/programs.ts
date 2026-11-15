/**
 * Deployed programs (§9): a Definition text bound to its natives, once per hash, and starting what
 * a host may start of it by key, with its arguments as JSON.
 *
 * - A host starts live or simple code only, as a live run (../scheduler/live-run.ts): in memory,
 *   never written to the store, its promise settling at its end with how it ended. Ista code runs
 *   in the contexts live code calls (§9), which the run's runtimes run (contexts.ts): a start's
 *   options (`crashEveryAwait`, §10) hold for those, and its name is what `runtime.id()` reads.
 */

import { type Definition, definitionFormat } from '../../definition/definition.ts';
import { memo } from '../../foundation/structures/memo.ts';
import type { HostExterns } from '../boundary/host-natives.ts';
import { outcomeJson, outcomeText } from '../boundary/outbound.ts';
import { jsonIn, startOf } from '../boundary/starts.ts';
import type { Clock } from '../clock.ts';
import type {
  Advanced,
  Finished,
  InstanceState,
  LogRecord,
  StartOptions,
} from '../instance-state.ts';
import type { Natives } from '../natives.ts';
import { runLive } from '../scheduler/live-run.ts';
import {
  type HeapCheck,
  type LoadedDefinition,
  loadDefinition,
} from '../scheduler/loaded-definition.ts';
import type { Resident } from '../scheduler/resident.ts';
import { type Advance, type AdvanceFirst, unstarted } from '../scheduler/wake.ts';
import { seedTextOf } from '../snapshot/random.ts';
import type { InstanceStore } from '../store.ts';
import { Contexts, type InstanceObserver } from './contexts.ts';
import type { InstanceCalls } from './instance-calls.ts';

/**
 * Reads and binds Definition texts: each text is read, validated and written back once, and each
 * hash bound once, since every operation on a stored instance binds the text its snapshot names.
 * The canonical text finds its binding too, as the store gives that text back. It writes nothing.
 */
export function programBinder(seams: BindingSeams) {
  const byHash = new Map<string, Binding>();
  const byText = new Map<string, Binding>();
  return (text: string): Binding =>
    memo(byText, text, () => {
      const { value: definition, hash, text: canonical } = definitionFormat.readCanonical(text);
      const binding = memo(byHash, hash, () => ({
        program: boundProgram(seams, definition, hash),
        canonical,
      }));
      byText.set(binding.canonical, binding);
      return binding;
    });
}

/** `definition`, bound to its natives and able to start its instances. */
function boundProgram(seams: BindingSeams, definition: Definition, hash: string): BoundProgram {
  const loaded = loadDefinition(definition, hash, seams.natives, { heapCheck: seams.heapCheck });
  const program: BoundProgram = {
    ...loaded,
    starts: definition.starts.map(({ key }) => key),
    outcome: (finished) => outcomeJson(finished, definition),
    outcomeText: (finished) => outcomeText(finished, definition),
    start: async (run, { function: key, arguments: given = [], ...options } = {}) => {
      const { entry, encoder } = startOf(definition, key, given.length);
      const values = given.map((json) => jsonIn(definition, json));
      const call = { function: entry, captures: [], arguments: values };
      const begun = unstarted(program, run, call, { seed: seedTextOf(seams.seed()), encoder });
      const contexts = new Contexts({
        ...seams,
        reports: seams.reports ?? unheard,
        program,
        beginning: () => ({ ...options, seed: seedTextOf(seams.seed()) }),
      });
      return await runLive(seams.clock, program, begun, contexts);
    },
  };
  return program;
}

/** A Definition text bound to its program, with the canonical text the store keeps. */
interface Binding {
  readonly program: BoundProgram;
  readonly canonical: string;
}

/** A deployed program as the runtime holds it: bound to its natives, the program it loads. */
export interface BoundProgram extends DeployedProgram, LoadedDefinition {}

/**
 * What binding a program needs: its natives, its host's, seeds, the clock its live runs wait on,
 * how to advance an instance, and the host's calls on each instance, one after another.
 */
interface BindingSeams
  extends Pick<RuntimeSeams, 'natives' | 'seed' | 'store' | 'clock' | 'reports' | 'heapCheck'> {
  /** The instance `instance` as the runtime holds it, or reads it from the store; none for none. */
  readonly residentOf: (instance: string) => Resident<BoundProgram> | undefined;
  readonly advance: (resident: Resident<BoundProgram>, first?: AdvanceFirst) => Advance;
  /** Has `observer` shown every advance of the runtime's instances, until the call it gives. */
  readonly observe: (observer: InstanceObserver) => () => void;
  readonly calls: InstanceCalls;
}

export interface RuntimeSeams {
  readonly natives: Natives;
  readonly store: InstanceStore;
  /**
   * The host's time: when each segment starts (§5), and what a live run waits on for its timers.
   */
  readonly clock: Clock;
  /**
   * A new secret seed, `seedBytes` random bytes (../snapshot/random.ts), for each run a host starts
   * and each context it makes: the source of its random values (§3.8 `random`). An instance one
   * spawns is seeded from it in turn. A seed of another length refuses the start.
   */
  readonly seed: () => Uint8Array;
  /**
   * The externs the host implements, against JSON, by key (§9); a Refusal for a key `natives`
   * has, such as `time.now()`, which would replace the runtime's own.
   */
  readonly host?: HostExterns;
  /** Told what the contexts a live run drives report, as no host call returns it; else dropped. */
  readonly reports?: HostReports;
  /**
   * A test's check of every instance's heap as it changes (lifetimes/oracle.test-kit.ts);
   * a host has none.
   */
  readonly heapCheck?: HeapCheck | undefined;
}

/** What a host hears of the work the contexts a live run drives do by themselves (§9). */
export interface HostReports {
  /** The log records a commit of theirs reported, as it commits (§3.8 `log`). */
  readonly logs: (records: readonly LogRecord[]) => void;
  /**
   * `instance` panicked with no call into it waiting to hear it: one a context spawned, or a
   * context whose caller is gone.
   */
  readonly panicked: (
    instance: string,
    panic: Extract<InstanceState, { kind: 'panicked' }>,
  ) => void;
}

const unheard: HostReports = { logs: () => undefined, panicked: () => undefined };

/** What a host starts: `main`, or the function it names by key, with its arguments as JSON (§9). */
interface StartRequest extends StartOptions {
  readonly function?: string;
  readonly arguments?: readonly unknown[];
}

export interface DeployedProgram {
  readonly hash: string;
  /** The keys of the functions a host may start (§9). */
  readonly starts: readonly string[];
  /**
   * A finished instance's outcome as JSON a host works with; a Refusal when no codec writes its
   * type, so it has none (§9).
   */
  readonly outcome: (finished: Finished) => unknown;
  /** The same outcome as its JSON text (§9). */
  readonly outcomeText: (finished: Finished) => string;
  /**
   * Runs what `request` names, live or simple code, as a live run named `run`, which settles at its
   * end (§9); its options hold for the contexts it makes. A Refusal if no function has the key, if
   * it is ista code, or if the arguments don't fit it.
   */
  readonly start: (run: string, request?: StartRequest) => Promise<Advanced>;
}
