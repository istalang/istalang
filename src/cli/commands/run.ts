/**
 * `ista run <entry>`: compile the program rooted at `entry` and run its `async fn main()` (§9) as
 * a new instance, printing its outcome as JSON. `--store <dir>` persists the Definition and every
 * commit in a directory; `ista run --store <dir> --resume <instance>` continues an instance from
 * its last commit there, on the Definition it started with (§5).
 *
 * The instance runs on real time: when it waits, the command sleeps until its earliest timer is
 * due and wakes it. Nothing runs unless the whole program checks clean. Diagnostics, warnings
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
import type { InstanceState } from '../../runtime/instance-state.ts';
import { Refusal } from '../../runtime/refusal.ts';
import { memoryStore } from '../../runtime/store.ts';
import { stdNatives } from '../../stdlib/natives.ts';
import type { CliEnvironment, CommandDefinition } from '../command.ts';
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
): Promise<number> {
  if ((entry === undefined) === (options.resume === undefined)) {
    environment.writeError('ista: run takes an entry, or --resume with --store, but not both.\n');
    return 2;
  }
  if (options.resume !== undefined && options.store === undefined) {
    environment.writeError('ista: --resume needs the --store that holds the instance.\n');
    return 2;
  }
  const runtime = createRuntime({
    natives: stdNatives,
    store:
      options.store === undefined
        ? memoryStore()
        : directoryStore(resolve(environment.cwd, options.store)),
    now: () => BigInt(Date.now()),
  });
  const instance = options.resume;
  if (instance !== undefined) {
    return (await unlessRefused(environment, () => resume(runtime, instance, environment))) ?? 1;
  }
  return entry === undefined ? 2 : start(runtime, entry, options, environment);
}

async function start(
  runtime: Runtime,
  entry: string,
  options: RunOptions,
  environment: CliEnvironment,
): Promise<number> {
  const { program, unreadable } = loadProject(environment.cwd, [entry]);
  const [root] = program.roots;
  if (unreadable.length > 0 || root === undefined) {
    environment.writeError(`ista: no such file: ${entry}\n`);
    return 2;
  }
  reportDiagnostics(diagnose(program).values(), environment.writeError);
  const compilation = compileProgram(program, root);
  switch (compilation.kind) {
    case 'failed':
      return 1;
    case 'noMain':
      environment.writeError(`ista: ${entry} declares no 'async fn main()'.\n`);
      return 1;
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
      return outcome ?? 1;
    }
    default: {
      const unhandled: never = compilation;
      return unhandled;
    }
  }
}

function resume(runtime: Runtime, name: string, environment: CliEnvironment): Promise<number> {
  const program = runtime.programOf(name);
  return finish({ runtime, program, name }, runtime.wake(name), environment);
}

/** An instance the command drives: its name, the runtime that runs it, and its program. */
interface Driven {
  readonly runtime: Runtime;
  readonly program: DeployedProgram;
  readonly name: string;
}

/** Wakes the instance whenever its next timer is due until it ends; prints how it ended. */
async function finish(
  { runtime, program, name }: Driven,
  initial: InstanceState,
  environment: CliEnvironment,
): Promise<number> {
  let state = initial;
  while (state.kind === 'waiting') {
    if (state.until === undefined) {
      environment.writeError(`ista: instance ${name} waits on nothing that can wake it.\n`);
      return 1;
    }
    // biome-ignore lint/performance/noAwaitInLoops: each wake depends on what the last one returned.
    await sleep(Math.max(0, Number(state.until - BigInt(Date.now()))));
    state = runtime.wake(name);
  }
  if (state.kind === 'panicked') {
    environment.writeError(`panic: ${state.message}\n${state.trace}\n`);
    return 1;
  }
  environment.write(`${program.json(state.value)}\n`);
  return 0;
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
