/**
 * Starting a compiled program's live code, as a host does (§9; ir-first design, decision 10): the
 * one host binding (host/binding.ts), with a store of the start's own, serves `ista build`'s output
 * (`istalang/live`) and the goldens as a host's runtime serves `ista run`.
 *
 * - A program is compiled once per Definition (codegen), and each start is a run of its own; a
 *   built program brings its code, compiled when it was built (live/program.ts).
 * - A start runs the start entry its key names, `main`'s with none (boundary/starts.ts), with the
 *   host's JSON arguments, and drives the run until the outcome settles: what is ready first, then
 *   what arrives from a host, then the clock to the next timer, while anything is left to wait for.
 *   The outcome is the JSON its start encoded; a panic ends the run with its message and trace.
 */

import { type EmittedProgram, emitProgram } from '../codegen/emit.ts';
import type { KeyedDefinition } from '../definition/definition.ts';
import type { Definition } from '../definition/tables/index.ts';
import { jsonTypeOf, plainOfJson } from '../definition/values/json-values.ts';
import { memo } from '../foundation/structures/memo.ts';
import type { HostBinding } from './host/binding.ts';
import { DurableWorld } from './host/durable-world.ts';
import { deployed } from './host/programs.ts';
import type { LogRecord } from './instance-state.ts';
import { memoryStore } from './store.ts';

/** What a start is bound to: a host binding but for the store and reports, its own (`startLive`). */
type StartBinding = Omit<HostBinding, 'store' | 'reports'>;

/** How a live start ended: its outcome as JSON, its panic, or waiting on nothing left to come. */
export type LiveEnd =
  | { readonly kind: 'finished'; readonly outcome: unknown; readonly text: string }
  | { readonly kind: 'panicked'; readonly message: string; readonly trace: string }
  | { readonly kind: 'unsettled' };

interface LiveRun {
  readonly end: LiveEnd;
  readonly logs: readonly LogRecord[];
}

/** What a start names: its key, `main`'s without one, its arguments as JSON, the run's name. */
export interface Start {
  readonly key?: string;
  readonly arguments?: readonly unknown[];
  readonly instance?: string;
  /** Whether the contexts it makes crash at every await (§10). */
  readonly crashEveryAwait?: boolean;
}

/** The code a start runs: compiled from its Definition once, unless a built program brings it. */
interface LiveCode {
  readonly code?: EmittedProgram;
  /**
   * The code each run read back from a snapshot runs: `code`, but in a test of two builds of one
   * Definition (docs/work/done/ir-first/contracts.md), which gives another.
   */
  readonly readBack?: () => EmittedProgram;
}

const emitted = new WeakMap<Definition, EmittedProgram>();

/**
 * Starts `keyed`'s live code as `start` says, bound by `binding`, running `live`'s code; how it
 * ended. The ista instances it reaches are the world's, in a store of their own that ends with
 * the start, committed at every await as any host's are (§5).
 */
export async function startLive(
  { definition, hash }: KeyedDefinition,
  binding: StartBinding,
  start: Start = {},
  live: LiveCode = {},
): Promise<LiveRun> {
  const logs: LogRecord[] = [];
  const program = {
    definition,
    hash,
    emitted: live.code ?? memo(emitted, definition, () => emitProgram(definition)),
  };
  const { readBack } = live;
  const world = new DurableWorld(
    {
      ...binding,
      store: memoryStore(),
      reports: { logs: (records) => logs.push(...records), panicked: () => undefined },
    },
    () => (readBack === undefined ? program : { ...program, emitted: readBack() }),
  );
  const started = deployed(world, program);
  const { state, logs: own } = await started.start(start.instance ?? 'run', {
    ...(start.key === undefined ? {} : { function: start.key }),
    ...(start.arguments === undefined ? {} : { arguments: start.arguments }),
    ...(start.crashEveryAwait === undefined ? {} : { crashEveryAwait: start.crashEveryAwait }),
  });
  logs.push(...own);
  switch (state.kind) {
    case 'finished':
      return {
        end: {
          kind: 'finished',
          outcome: plainOfJson(state.encoded ?? state.outcome, jsonTypeOf(definition.types)),
          text: started.outcomeText(state),
        },
        logs,
      };
    case 'panicked':
    case 'terminated':
      return { end: { kind: 'panicked', message: state.message, trace: state.trace }, logs };
    default:
      return { end: { kind: 'unsettled' }, logs };
  }
}
