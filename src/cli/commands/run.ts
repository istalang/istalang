/**
 * `ista run <entry>`: compile the program rooted at `entry` and run its `live async fn main()`
 * (§9) as a live run, printing its outcome as JSON. Its ista work runs in the contexts its
 * runtimes open over the host's store (§9): `--store <dir>` keeps the Definition and every commit
 * in a directory, so running a program again on it resumes the contexts it left, and memory keeps
 * them otherwise. `--host <module>` loads the externs the program's host implements from a
 * JavaScript module (host-module.ts), whose promises resolve the live futures `main` waits on.
 *
 * `main` runs on real time, its timers and its contexts' on the system clock, until it ends: its
 * outcome is printed, its panic, with a context's that reached it, reported, and a `main` that
 * waits on nothing that can wake it reported so, with where the store's instances wait. An
 * instance its contexts spawned that panics, heard by no call, is reported as it panics and fails
 * the run. Nothing runs unless the whole program checks
 * clean. Diagnostics, warnings included, go to the error stream as `check` renders them, and so
 * does each log record `main` and its contexts committed, as a line of JSON (§9), so the output
 * holds only the outcome.
 * Exit codes: 0 when `main` finishes; 1 when the program has errors, declares no `main`, panics,
 * the runtime refuses it, an instance panics unheard, or `main` waits on nothing that can wake it; 2 when the entry can't be
 * read or the host module can't implement externs.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { compileProgram, diagnose } from '../../compiler/compile.ts';
import { definitionFormat } from '../../definition/definition.ts';
import { FormatError } from '../../definition/formats/format.ts';
import { loadProject } from '../../project/project.ts';
import { createRuntime, type Runtime } from '../../runtime/host/index.ts';
import type { DeployedProgram, HostReports } from '../../runtime/host/programs.ts';
import type { Advanced } from '../../runtime/instance-state.ts';
import { Refusal } from '../../runtime/refusal.ts';
import { seedBytes } from '../../runtime/snapshot/random.ts';
import { type InstanceStore, memoryStore } from '../../runtime/store.ts';
import { stdNatives } from '../../stdlib/natives.ts';
import { clock } from '../clock.ts';
import {
  type CliEnvironment,
  type CommandDefinition,
  type ExitCode,
  exitCodes,
} from '../command.ts';
import { directoryStore } from '../directory-store.ts';
import { loadHostModule } from '../host-module.ts';
import { logLine } from '../log-lines.ts';
import { reportDiagnostics, reportUnreadable } from '../report.ts';

interface RunOptions {
  readonly store?: string;
  readonly host?: string;
}

export const defineRunCommand: CommandDefinition = (cli, { environment, exitWith }) => {
  cli
    .command('run')
    .description("run a program's live async fn main() and print its outcome")
    .argument('[entry]', 'the module declaring main')
    .option('--store <dir>', 'keep the Definition and every commit in this directory')
    .option('--host <module>', "load the externs the program's host implements from a module")
    .action(async (entry: string | undefined, options: RunOptions) => {
      exitWith(await run(entry, options, environment));
    });
};

async function run(
  entry: string | undefined,
  options: RunOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  if (entry === undefined) {
    environment.writeError('ista: run takes the entry module declaring main.\n');
    return exitCodes.couldNotRun;
  }
  const loaded =
    options.host === undefined
      ? undefined
      : await loadHostModule(resolve(environment.cwd, options.host));
  if (loaded?.kind === 'unfit') {
    environment.writeError(`ista: ${loaded.problem}\n`);
    return exitCodes.couldNotRun;
  }
  const host = loaded?.externs;
  const store =
    options.store === undefined
      ? memoryStore()
      : directoryStore(resolve(environment.cwd, options.store));
  const reports = errorStreamReports(environment);
  const runtime = createRuntime({
    natives: stdNatives,
    store,
    clock,
    seed: () => randomBytes(seedBytes),
    reports,
    ...(host === undefined ? {} : { host }),
  });
  return start({ runtime, store, reports, environment }, entry, options);
}

/** What a run runs `main` with: its runtime over `store`, what its contexts report, where it writes. */
interface Session {
  readonly runtime: Runtime;
  readonly store: InstanceStore;
  readonly reports: RunReports;
  readonly environment: CliEnvironment;
}

/** What the run's contexts report, and whether an instance among them panicked unheard. */
interface RunReports extends HostReports {
  readonly failed: () => boolean;
}

/**
 * Reports written to the error stream: each log record as a line of JSON, and each instance that
 * panicked with no call hearing it, which fails the run, as a spawned one does (§9).
 */
function errorStreamReports(environment: CliEnvironment): RunReports {
  let failed = false;
  return {
    logs: (records) => {
      for (const record of records) {
        environment.writeError(`${logLine(record)}\n`);
      }
    },
    panicked: (instance, { message, trace }) => {
      failed = true;
      environment.writeError(`ista: instance ${instance} panicked: ${message}\n${trace}\n`);
    },
    failed: () => failed,
  };
}

async function start(session: Session, entry: string, options: RunOptions): Promise<ExitCode> {
  const { runtime, environment } = session;
  const { program, unreadable } = loadProject(environment.cwd, [entry]);
  const [root] = program.roots;
  if (unreadable.length > 0 || root === undefined) {
    reportUnreadable([entry], environment.writeError);
    return exitCodes.couldNotRun;
  }
  reportDiagnostics(diagnose(program).values(), environment.writeError);
  const compilation = compileProgram(program, root);
  switch (compilation.kind) {
    case 'failed':
      return exitCodes.problems;
    case 'noMain':
      environment.writeError(`ista: ${entry} declares no 'live async fn main()'.\n`);
      return exitCodes.problems;
    case 'compiled': {
      const { text } = definitionFormat.write(compilation.definition);
      const outcome = await unlessRefused(environment, async () => {
        const deployed = runtime.deploy(text);
        const name = randomUUID();
        if (options.store !== undefined) {
          environment.writeError(`ista: run ${name}\n`);
        }
        return finish(session, deployed, await untilIdle(session, deployed.start(name)));
      });
      return outcome ?? exitCodes.problems;
    }
    default: {
      const unhandled: never = compilation;
      return unhandled;
    }
  }
}

/**
 * What `running`, `main`'s live run, ends with; once the process goes idle, nothing is left that
 * could settle a host's promise or come due, so `main` waits on nothing that can wake it.
 */
function untilIdle({ environment }: Session, running: Promise<Advanced>): Promise<Advanced> {
  return Promise.race([running, environment.idle.then(() => stuck)]);
}

/** How a `main` the process went idle under ended: waiting on nothing that can wake it. */
const stuck: Advanced = {
  state: { kind: 'waiting', until: undefined, watching: [] },
  spawned: [],
  logs: [],
};

/**
 * Prints how `main`'s live run ended: its logs, then its outcome, or why it didn't finish; a run
 * in which an instance panicked unheard fails all the same.
 */
function finish(
  { runtime, store, reports, environment }: Session,
  program: DeployedProgram,
  { state, logs }: Advanced,
): ExitCode {
  reports.logs(logs);
  switch (state.kind) {
    case 'finished':
      environment.write(`${program.outcomeText(state)}\n`);
      return reports.failed() ? exitCodes.problems : exitCodes.clean;
    case 'panicked':
    case 'terminated':
      environment.writeError(`panic: ${state.message}\n${state.trace}\n`);
      return exitCodes.problems;
    default:
      environment.writeError(
        `ista: main waits on nothing that can wake it${waitsOf(runtime, store)}.\n`,
      );
      return exitCodes.problems;
  }
}

/** Where the store's instances that wait stand, the contexts `main` called among them, as `, at …`. */
function waitsOf(runtime: Runtime, store: InstanceStore): string {
  const where = store.instances().flatMap((instance) => {
    const { state, waitingAt } = runtime.inspect(instance);
    return state.kind === 'waiting'
      ? waitingAt.map(({ waypoint, location }) => waypoint ?? location)
      : [];
  });
  return where.length === 0 ? '' : `, at ${where.join(', ')}`;
}

/**
 * What `action` gives; undefined after reporting a refusal it raised (runtime/refusal.ts), such as
 * a Definition the runtime can't run or an outcome without a JSON form yet. Anything else the
 * runtime throws is a bug in the toolchain and propagates with its stack.
 */
async function unlessRefused<Result>(
  environment: CliEnvironment,
  action: () => Promise<Result>,
): Promise<Result | undefined> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof Refusal || error instanceof FormatError)) {
      throw error;
    }
    environment.writeError(`ista: ${error.message}\n`);
    return undefined;
  }
}
