/**
 * `ista run <entry>`: compile the program rooted at `entry` and run its `async fn main()` (§9) as
 * a new instance, printing its outcome as JSON. `--store <dir>` persists the Definition and every
 * commit in a directory; `ista run --store <dir> --resume <instance>` continues an instance from
 * its last commit there, on the Definition it started with (§5). `--host <module>` loads the
 * externs the program's host implements from a JavaScript module (host-module.ts).
 *
 * The instance runs on real time: when it waits, the command sleeps until its earliest timer is
 * due, or until a promise its host gave settles, and wakes it. When nothing is left that could
 * wake it, it reports where it waits; a host's promise can wake it only while the process has
 * something left to run, since once it has nothing, no promise can settle. Every instance it spawns runs alongside it, theirs too,
 * until all of them have settled; `main`'s outcome is printed, and a spawned instance that panics
 * or can never wake is reported on the error stream and fails the run. Nothing runs unless the
 * whole program checks clean. Diagnostics, warnings included, go to the error stream as `check`
 * renders them, and so does each log record its instances commit, as a line of JSON (§9), so the
 * output holds only the outcome.
 * Exit codes: 0 when `main` finishes; 1 when the program has errors, declares no `main`, panics,
 * the runtime refuses it, or an instance waits on nothing that can wake it; 2 when the entry
 * can't be read, the options don't fit together, or the host module can't implement externs.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { compileProgram, diagnose } from '../../compiler/compile.ts';
import { definitionFormat } from '../../definition/definition.ts';
import { FormatError } from '../../definition/formats/format.ts';
import { loadProject } from '../../project/project.ts';
import { type Settled, settle } from '../../runtime/host/drive.ts';
import { createRuntime, type DeployedProgram, type Runtime } from '../../runtime/host/index.ts';
import type { Advanced } from '../../runtime/instance-state.ts';
import { Refusal } from '../../runtime/refusal.ts';
import { seedBytes } from '../../runtime/snapshot/random.ts';
import { memoryStore } from '../../runtime/store.ts';
import { stdNatives } from '../../stdlib/natives.ts';
import { clock } from '../clock.ts';
import {
  type CliEnvironment,
  type CommandDefinition,
  type ExitCode,
  exitCodes,
} from '../command.ts';
import { directoryStore } from '../directory-store.ts';
import { type HostModule, loadHostModule } from '../host-module.ts';
import { logLine } from '../log-lines.ts';
import { reportDiagnostics, reportUnreadable } from '../report.ts';

interface RunOptions {
  readonly store?: string;
  readonly resume?: string;
  readonly host?: string;
}

export const defineRunCommand: CommandDefinition = (cli, { environment, exitWith }) => {
  cli
    .command('run')
    .description("run a program's async fn main() and print its outcome")
    .argument('[entry]', 'the module declaring main')
    .option('--store <dir>', 'keep the Definition and every commit in this directory')
    .option('--resume <instance>', 'continue an instance from its last commit in --store')
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
  if ((entry === undefined) === (options.resume === undefined)) {
    environment.writeError('ista: run takes an entry, or --resume with --store, but not both.\n');
    return exitCodes.couldNotRun;
  }
  if (options.resume !== undefined && options.store === undefined) {
    environment.writeError('ista: --resume needs the --store that holds the instance.\n');
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
  const host = loaded?.module;
  const runtime = createRuntime({
    natives: stdNatives,
    store:
      options.store === undefined
        ? memoryStore()
        : directoryStore(resolve(environment.cwd, options.store)),
    now: clock.now,
    seed: () => randomBytes(seedBytes),
    ...(host === undefined ? {} : { host: host.externs }),
  });
  const session: Session = { runtime, host, environment };
  const instance = options.resume;
  if (instance !== undefined) {
    return (
      (await unlessRefused(environment, () => resume(session, instance))) ?? exitCodes.problems
    );
  }
  return entry === undefined ? exitCodes.couldNotRun : start(session, entry, options);
}

/** What a run drives its instances with: its runtime, its host module if any, where it writes. */
interface Session {
  readonly runtime: Runtime;
  readonly host: HostModule | undefined;
  readonly environment: CliEnvironment;
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
      environment.writeError(`ista: ${entry} declares no 'async fn main()'.\n`);
      return exitCodes.problems;
    case 'compiled': {
      const { text } = definitionFormat.write(compilation.definition);
      const outcome = await unlessRefused(environment, async () => {
        const deployed = runtime.deploy(text);
        const name = randomUUID();
        if (options.store !== undefined) {
          environment.writeError(`ista: instance ${name}\n`);
        }
        return finish(session, { program: deployed, name }, await deployed.start(name));
      });
      return outcome ?? exitCodes.problems;
    }
    default: {
      const unhandled: never = compilation;
      return unhandled;
    }
  }
}

async function resume(session: Session, name: string): Promise<ExitCode> {
  const { runtime } = session;
  return finish(session, { program: runtime.programOf(name), name }, await runtime.wake(name));
}

/** An instance the command runs: its name, and its program. */
interface RunningInstance {
  readonly program: DeployedProgram;
  readonly name: string;
}

/**
 * Waits for each timer the instance and those it spawned wait on, and for each promise its host
 * gave, and wakes them; prints how the instance ended, and reports each spawned instance that
 * didn't finish.
 */
async function finish(
  { runtime, host, environment }: Session,
  { program, name }: RunningInstance,
  initial: Advanced,
): Promise<ExitCode> {
  const writeLogs = ({ logs }: Advanced) => {
    for (const record of logs) {
      environment.writeError(`${logLine(record)}\n`);
    }
  };
  const settled = await settle(
    {
      wake: (instance) => runtime.wake(instance),
      now: clock.now,
      wait: (due) => arrivalsBy(due, { runtime, host, environment }),
      seen: writeLogs,
    },
    { instance: name, advanced: initial },
  );
  const unfinished = [...settled].flatMap(([instance, ending]) => {
    const role = instance === name ? 'main' : 'spawned';
    return failsRun(ending, role) ? [unfinishedText(runtime, instance, ending, role)] : [];
  });
  for (const text of unfinished) {
    environment.writeError(text);
  }
  const ended = settled.get(name);
  if (ended?.kind === 'finished') {
    environment.write(`${program.outcomeText(ended)}\n`);
  }
  return unfinished.length === 0 ? exitCodes.clean : exitCodes.problems;
}

/**
 * What the host filled by the time the earliest timer is due: waits, and waits again while only a
 * promise that failed settled and others are still pending, since a run ends when it is resumed
 * with nothing and no timer is due.
 */
async function arrivalsBy(due: bigint | undefined, session: Session) {
  const { runtime, host, environment } = session;
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: each wait depends on what the last one settled.
    const woke = await nextWake(due, session);
    const arrived = (await host?.arrivals(runtime, environment.writeError)) ?? [];
    if (arrived.length > 0 || due !== undefined || woke === 'idle' || host?.waiting() !== true) {
      return arrived;
    }
  }
}

/** Whether an instance is the run's `main` or one it spawned. */
type Role = 'main' | 'spawned';

/** What ended a wait: a timer came due or a host's promise settled, or the process went idle. */
type Wake = 'woke' | 'idle';

/**
 * Until the earliest timer is due, or the host's next promise settles, whichever is first; at once
 * when nothing could wake an instance, so the run ends. Waiting only on the host's promises ends
 * too when the process goes idle, since none of them can settle then. A sleep a promise cut short
 * is cancelled, so a far timer, such as a day's reminder, keeps no process alive once the run ends.
 */
async function nextWake(due: bigint | undefined, { host, environment }: Session): Promise<Wake> {
  const sleeping = new AbortController();
  const waits: Promise<Wake>[] = [];
  if (due !== undefined) {
    const delay = Math.max(0, Number(due - clock.now()));
    waits.push(sleep(delay, 'woke', { signal: sleeping.signal }));
  }
  if (host?.waiting() === true) {
    waits.push(
      host.nextSettled().then(() => 'woke' as const),
      environment.idle.then(() => 'idle' as const),
    );
  }
  if (waits.length === 0) {
    return 'woke';
  }
  const woke = await Promise.race(waits);
  sleeping.abort();
  return woke;
}

/**
 * Whether an instance that settled as `settled` fails the run: one that didn't finish, except a
 * spawned one that was terminated, which only `runtime.isolate` does in a run, once its caller has
 * the panic as an `Err` (§9).
 */
function failsRun(settled: Settled, role: Role): settled is Exclude<Settled, { kind: 'finished' }> {
  return settled.kind !== 'finished' && !(settled.kind === 'terminated' && role === 'spawned');
}

/** What the error stream says of an instance that didn't finish: `main`'s, or one it spawned. */
function unfinishedText(
  runtime: Runtime,
  instance: string,
  settled: Exclude<Settled, { kind: 'finished' }>,
  role: Role,
): string {
  if (settled.kind === 'stuck') {
    const where = runtime
      .inspect(instance)
      .waitingAt.map(({ waypoint, location }) => waypoint ?? location)
      .join(', ');
    return `ista: instance ${instance} waits on nothing that can wake it, at ${where}.\n`;
  }
  if (settled.kind === 'terminated') {
    return `ista: instance ${instance} was terminated.\n`;
  }
  const subject = role === 'main' ? 'panic' : `ista: instance ${instance} panicked`;
  return `${subject}: ${settled.message}\n${settled.trace}\n`;
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
