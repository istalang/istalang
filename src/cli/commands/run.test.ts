/**
 * `ista run` end to end. Every runnable corpus program (test/corpus/programs.ts) runs through the CLI
 * in-process and must have the outcome it states, so the whole pipeline (checker, lowering,
 * runtime, boundary) is what's tested, on real time. With a store, a run killed while it waits is
 * continued by a later `--resume`, in a process of its own.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it, vi } from 'vitest';
import { corpusDirectory as corpus, runPrograms } from '../../../test/corpus/programs.ts';
import { subsetOutcome, subsetSource } from '../../../test/definitions/subset.ts';
import { builtCli, ista, tempProject as project } from '../cli.test-kit.ts';

describe('ista run', () => {
  it.each(runPrograms.filter(({ expects }) => expects === 'outcome'))(
    'prints the outcome of $name',
    async ({ name, expected }) => {
      expect(await ista(corpus, 'run', name)).toEqual({ code: 0, out: `${expected}\n`, err: '' });
    },
  );

  it.each(runPrograms.filter(({ expects }) => expects === 'panic'))(
    'reports the panic of $name with a trace of where each frame stood',
    async ({ name, expected }) => {
      const run = await ista(corpus, 'run', name);
      expect(run.code).toBe(1);
      expect(run.out).toBe('');
      expect(run.err).toMatch(
        new RegExp(`^panic: ${expected}\\n(at \\S+ \\(\\S+:\\d+:\\d+\\)\\n)+$`, 'u'),
      );
    },
  );

  it('runs the program the hand-written subset Definition was written from', async () => {
    const run = await ista(project({ 'main.ista': subsetSource }), 'run', 'main.ista');
    expect(run).toEqual({ code: 0, out: `${subsetOutcome}\n`, err: '' });
  });

  it('prints a struct outcome as an object keyed by field name', async () => {
    const text = 'struct P { x: int; y: string }\nasync fn main(): P{y: "b", x: 1}\n';
    const run = await ista(project({ 'main.ista': text }), 'run', 'main.ista');
    expect(run).toEqual({ code: 0, out: '{"x":1,"y":"b"}\n', err: '' });
  });

  it('prints a float JSON cannot hold as null, as JavaScript does', async () => {
    const text = 'async fn main(): 1e308 * 10.0\n';
    const run = await ista(project({ 'main.ista': text }), 'run', 'main.ista');
    expect(run).toEqual({ code: 0, out: 'null\n', err: '' });
  });

  it('reports warnings on the error stream and still runs', async () => {
    const run = await ista(
      project({ 'main.ista': 'async fn main():\n  let x = 1\n  x\n' }),
      'run',
      'main.ista',
    );
    expect(run.code).toBe(0);
    expect(run.out).toBe('1\n');
    expect(run.err).toContain('warning 5009:');
  });

  it('runs nothing when the program has errors, reporting them', async () => {
    const run = await ista(
      project({ 'main.ista': 'async fn main():\n  1 + "a"\n' }),
      'run',
      'main.ista',
    );
    expect(run.code).toBe(1);
    expect(run.out).toBe('');
    expect(run.err).toContain("main.ista:2:3: error 5016: '+' isn't defined for int and string.");
  });

  it.each([
    ['no main at all', 'fn helper() -> int: 1\n'],
    ['a generic main', 'async fn main<T>(): 1\n'],
    ['a main that is not async', 'fn main() -> int: 1\n'],
    ['a main that takes parameters', 'async fn main(n: int): n\n'],
  ])('refuses an entry with %s', async (_case, text) => {
    const run = await ista(project({ 'main.ista': text }), 'run', 'main.ista');
    expect(run).toEqual({
      code: 1,
      out: '',
      err: "ista: main.ista declares no 'async fn main()'.\n",
    });
  });

  it('is a usage error to run a file that does not exist', async () => {
    expect(await ista(project({}), 'run', 'nope.ista')).toEqual({
      code: 2,
      out: '',
      err: 'ista: no such file: nope.ista\n',
    });
  });
});

const waitingProgram = [
  "import * as time from 'time'",
  'async fn main():',
  '  const start = time.now()',
  '  await time.delay(300ms)',
  '  time.now().value - start.value >= 300',
  '',
].join('\n');

const instanceLine = /^ista: instance (?<name>\S+)$/mu;

describe('ista run with a store', () => {
  it('continues an instance killed while it waits, from its last commit', async () => {
    const root = project({ 'main.ista': waitingProgram });
    const main = builtCli;
    const child = spawn(process.execPath, [main, 'run', '--store', 'store', 'main.ista'], {
      cwd: root,
    });
    let err = '';
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });
    const exited = new Promise((done) => child.on('exit', done));
    const name = await vi.waitFor(() => {
      const found = instanceLine.exec(err)?.groups?.name;
      expect(found).toBeDefined();
      return found ?? '';
    });
    await vi.waitFor(() => {
      expect(existsSync(join(root, 'store', 'instances', `${name}.json`))).toBe(true);
    });
    child.kill();
    await exited;
    const resumed = await ista(root, 'run', '--store', 'store', '--resume', name);
    expect(resumed).toEqual({ code: 0, out: 'true\n', err: '' });
  });

  it('reports an instance the store lacks', async () => {
    const resumed = await ista(project({}), 'run', '--store', 'store', '--resume', 'nobody');
    expect(resumed).toEqual({
      code: 1,
      out: '',
      err: "ista: The store holds no instance 'nobody'.\n",
    });
  });

  it.each([
    ['both an entry and --resume', ['main.ista', '--store', 's', '--resume', 'x']],
    ['neither an entry nor --resume', []],
    ['--resume without --store', ['--resume', 'x']],
  ])('is a usage error to give %s', async (_case, args) => {
    const run = await ista(project({ 'main.ista': waitingProgram }), 'run', ...args);
    expect(run.code).toBe(2);
    expect(run.out).toBe('');
  });
});
