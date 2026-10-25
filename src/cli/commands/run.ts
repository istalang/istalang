/**
 * `ista run <entry>`: compile the program rooted at `entry` and run its `async fn main()` (§9) as
 * a new instance, printing its outcome as JSON. `--store <dir>` persists the Definition and every
 * commit in a directory; `ista run --store <dir> --resume <instance>` continues an instance from
 * its last commit there, on the Definition it started with (§5).
 *
 * The instance runs on real time: when it waits, the command sleeps until its earliest timer is
 * due and wakes it. Every instance it spawns runs alongside it, theirs too, until all of them have
 * settled; `main`'s outcome is printed, and a spawned instance that panics or can never wake is
 * reported on the error stream and fails the run. Nothing runs unless the whole program checks
 * clean. Diagnostics, warnings
 * included, go to the error stream as `check` renders them, so the output holds only the outcome.
 * Exit codes: 0 when `main` finishes; 1 when the program has errors, declares no `main`, panics,
 * or the runtime refuses it; 2 when the entry can't be read or the options don't fit together.
 */

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { compileProgram, diagnose } from '../../compiler/compile.ts';
import { definitionFormat } from '../../definition/definition.ts';
import { FormatError } from '../../definition/format.ts';
import { createRuntime, type DeployedProgram, type Runtime } from '../../runtime/host.ts';
import type { Advanced } from '../../runtime/instance-state.ts';
import { Refusal } from '../../runtime/refusal.ts';
import { type Settled, settle } from '../../runtime/settle.ts';
import { memoryStore } from '../../runtime/store.ts';
import { stdNatives } from '../../stdlib/natives.ts';
import {
  type CliEnvironment,
  type CommandDefinition,
  type ExitCode,
  exitCodes,
} from '../command.ts';
import { directoryStore } from '../directory-store.ts';
import { loadProject } from '../project.ts';
import { reportDiagnostics } from '../report.ts';

interface RunOptions {
  readonly store?: string;
  readonly resume?: string;
}

export const defineRunCommand: CommandDefinition = (cli, { environment, exitWith }) => {
  cli
    .command('run')
    .description("run a program's async fn main() and print its outcome")
    .argument('[entry]', 'the module declaring main')
    .option('--store <dir>', 'keep the Definition and every commit in this directory')
    .option('--resume <instance>', 'continue an instance from its last commit in --store')
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
  const runtime = createRuntime({
    natives: stdNatives,
    store:
      options.store === undefined
        ? memoryStore()
        : directoryStore(resolve(environment.cwd, options.store)),
    now: clock,
  });
  const instance = options.resume;
  if (instance !== undefined) {
    return (
      (await unlessRefused(environment, () => resume(runtime, instance, environment))) ??
      exitCodes.problems
    );
  }
  return entry === undefined ? exitCodes.couldNotRun : start(runtime, entry, options, environment);
}

async function start(
  runtime: Runtime,
  entry: string,
  options: RunOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const { program, unreadable } = loadProject(environment.cwd, [entry]);
  const [root] = program.roots;
  if (unreadable.length > 0 || root === undefined) {
    environment.writeError(`ista: no such file: ${entry}\n`);
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
      const outcome = await unlessRefused(environment, () => {
        const deployed = runtime.deploy(text);
        const name = randomUUID();
        if (options.store !== undefined) {
          environment.writeError(`ista: instance ${name}\n`);
        }
        return finish({ runtime, program: deployed, name }, deployed.start(name), environment);
      });
      return outcome ?? exitCodes.problems;
    }
    default: {
      const unhandled: never = compilation;
      return unhandled;
    }
  }
}

function resume(runtime: Runtime, name: string, environment: CliEnvironment): Promise<ExitCode> {
  const program = runtime.programOf(name);
  return finish({ runtime, program, name }, runtime.wake(name), environment);
}

/** The command's one clock: segment start times, and how long to sleep until a timer is due. */
function clock(): bigint {
  return BigInt(Date.now());
}

/** An instance the command runs: its name, the runtime that runs it, and its program. */
interface RunningInstance {
  readonly runtime: Runtime;
  readonly program: DeployedProgram;
  readonly name: string;
}

/**
 * Sleeps until each timer the instance and those it spawned wait on is due and wakes them; prints
 * how the instance ended, and reports each spawned instance that didn't finish.
 */
async function finish(
  { runtime, program, name }: RunningInstance,
  initial: Advanced,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const steps = settle((instance) => runtime.wake(instance), { instance: name, advanced: initial });
  let step = steps.next();
  while (!step.done) {
    // biome-ignore lint/performance/noAwaitInLoops: each wake depends on what the last one returned.
    await sleep(Math.max(0, Number(step.value - clock())));
    step = steps.next();
  }
  const unfinished = [...step.value].flatMap(([instance, ending]) =>
    ending.kind === 'finished'
      ? []
      : [unfinishedText(instance, ending, instance === name ? 'main' : 'spawned')],
  );
  for (const text of unfinished) {
    environment.writeError(text);
  }
  const settled = step.value.get(name);
  if (settled?.kind === 'finished') {
    environment.write(`${program.json(settled.outcome)}\n`);
  }
  return unfinished.length === 0 ? exitCodes.clean : exitCodes.problems;
}

/** What the error stream says of an instance that didn't finish: `main`'s, or one it spawned. */
function unfinishedText(
  instance: string,
  settled: Exclude<Settled, { kind: 'finished' }>,
  role: 'main' | 'spawned',
): string {
  if (settled.kind === 'stuck') {
    return `ista: instance ${instance} waits on nothing that can wake it.\n`;
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
