/**
 * `ista run` end to end, through the CLI in-process, on real time: what it prints, logs and
 * reports (every corpus program's outcome is run.sweep.test.ts's). With a store, a run killed
 * while it waits is continued by a later `--resume`, in a process of its own.
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { subsetOutcome, subsetSource } from '../../../test/definitions/subset.ts';
import { tempProject as project } from '../../project/project.test-kit.ts';
import { builtCli, ista } from '../cli.test-kit.ts';

/** The start of an ISO 8601 time, as a log record's is written (§9). */
const isoTime = /^\d{4}-\d{2}-\d{2}T/u;

describe('ista run', () => {
  it('runs the program the hand-written subset Definition was written from', async () => {
    const run = await ista(project({ 'main.ista': subsetSource }), 'run', 'main.ista');
    expect(run).toEqual({ code: 0, out: `${subsetOutcome}\n`, err: '' });
  });

  it('prints a struct outcome as an object keyed by field name', async () => {
    const text = 'struct P { x: Int, y: String }\nista async fn main(): P{y: "b", x: 1}\n';
    const run = await ista(project({ 'main.ista': text }), 'run', 'main.ista');
    expect(run).toEqual({ code: 0, out: '{"x":1,"y":"b"}\n', err: '' });
  });

  it('prints a float JSON cannot hold as null, as JavaScript does', async () => {
    const text = 'ista async fn main(): 1e308 * 10.0\n';
    const run = await ista(project({ 'main.ista': text }), 'run', 'main.ista');
    expect(run).toEqual({ code: 0, out: 'null\n', err: '' });
  });

  it('writes each committed log record to the error stream as a line of JSON', async () => {
    const text = [
      "import * as log from 'log'",
      'ista async fn main() -> Int:',
      '  log.warn("careful", struct{n: 2})',
      '  1',
    ].join('\n');
    const run = await ista(project({ 'main.ista': text }), 'run', 'main.ista');
    expect(run.out).toBe('1\n');
    expect(JSON.parse(run.err) as unknown).toEqual({
      fields: { n: 2 },
      instance: expect.any(String) as unknown,
      level: 'warn',
      message: 'careful',
      time: expect.stringMatching(isoTime) as unknown,
    });
  });

  it('reports warnings on the error stream and still runs', async () => {
    const run = await ista(
      project({ 'main.ista': 'ista async fn main():\n  let x = 1\n  x\n' }),
      'run',
      'main.ista',
    );
    expect(run.code).toBe(0);
    expect(run.out).toBe('1\n');
    expect(run.err).toContain('warning 5009:');
  });

  it('runs nothing when the program has errors, reporting them', async () => {
    const run = await ista(
      project({ 'main.ista': 'ista async fn main():\n  1 - "a"\n' }),
      'run',
      'main.ista',
    );
    expect(run.code).toBe(1);
    expect(run.out).toBe('');
    expect(run.err).toContain("main.ista:2:3: error 5016: '-' isn't defined for Int and String.");
  });

  it.each([
    ['no main at all', 'fn helper() -> Int: 1\n'],
    ['a generic main', 'ista async fn main<T>(): 1\n'],
    ['a main that is not async', 'fn main() -> Int: 1\n'],
    ['a main that takes parameters', 'ista async fn main(n: Int): n\n'],
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

/** A program that logs and then waits: its run writes the record once that segment committed. */
const waitingProgram = [
  "import * as log from 'log'",
  "import * as time from 'time'",
  'ista async fn main():',
  '  const start = time.now()',
  '  log.info("waiting")',
  '  await time.delay(300ms)',
  '  time.now().value - start.value >= 300',
  '',
].join('\n');

const instanceLine = /^ista: instance (?<name>\S+)$/mu;
const committedLog = /^\{.*"message":"waiting".*\}$/mu;

/**
 * What `child` wrote to its error stream by the time it wrote a line matching `line`; rejects if
 * it exits first. However long a loaded machine takes to start it, only the test's own time limit
 * gives up on it.
 */
function errorStreamUntil(child: ChildProcessWithoutNullStreams, line: RegExp): Promise<string> {
  return new Promise((written, failed) => {
    let err = '';
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString();
      if (line.test(err)) {
        written(err);
      }
    });
    child.on('exit', () => failed(new Error(`ista exited before writing ${line}:\n${err}`)));
  });
}

describe('ista run with a store', () => {
  it('continues an instance killed while it waits, from its last commit', async () => {
    const root = project({ 'main.ista': waitingProgram });
    const child = spawn(process.execPath, [builtCli, 'run', '--store', 'store', 'main.ista'], {
      cwd: root,
    });
    const exited = new Promise((done) => child.on('exit', done));
    // A run writes a log record once its segment committed, so the store holds the instance by then.
    const err = await errorStreamUntil(child, committedLog);
    const name = instanceLine.exec(err)?.groups?.name ?? '';
    expect(existsSync(join(root, 'store', 'instances', `${name}.json`))).toBe(true);
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
