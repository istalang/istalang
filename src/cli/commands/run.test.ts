/**
 * `ista run` end to end, through the CLI in-process, on real time: what it prints, logs and
 * reports (every corpus program's outcome is run.sweep.test.ts's). With a store, a run killed
 * while it waits is continued by a later `--resume`, in a process of its own.
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
    const text =
      'struct P { x: Int, y: String }\nimport * as runtime from \'runtime\'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): P{y: "b", x: 1}\n';
    const run = await ista(project({ 'main.ista': text }), 'run', 'main.ista');
    expect(run).toEqual({ code: 0, out: '{"x":1,"y":"b"}\n', err: '' });
  });

  it('prints a float JSON cannot hold as null, as JavaScript does', async () => {
    const text =
      "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): 1e308 * 10.0\n";
    const run = await ista(project({ 'main.ista': text }), 'run', 'main.ista');
    expect(run).toEqual({ code: 0, out: 'null\n', err: '' });
  });

  it('writes each committed log record to the error stream as a line of JSON', async () => {
    const text = [
      "import * as log from 'log'\nimport * as runtime from 'runtime'",
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
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
      project({
        'main.ista':
          "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():\n  let x = 1\n  x\n",
      }),
      'run',
      'main.ista',
    );
    expect(run.code).toBe(0);
    expect(run.out).toBe('1\n');
    expect(run.err).toContain('warning 5009:');
  });

  it('runs nothing when the program has errors, reporting them', async () => {
    const run = await ista(
      project({
        'main.ista':
          'import * as runtime from \'runtime\'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():\n  1 - "a"\n',
      }),
      'run',
      'main.ista',
    );
    expect(run.code).toBe(1);
    expect(run.out).toBe('');
    expect(run.err).toContain("main.ista:4:3: error 5016: '-' isn't defined for Int and String.");
  });

  it.each([
    ['no main at all', 'fn helper() -> Int: 1\n'],
    ['a generic main', 'live async fn main<T>(): 1\n'],
    ['a main that is not async', 'fn main() -> Int: 1\n'],
    ['a main that takes parameters', 'live async fn main(n: Int): n\n'],
    ['an ista main', 'ista async fn main() -> Int: 1\n'],
  ])('refuses an entry with %s', async (_case, text) => {
    const run = await ista(project({ 'main.ista': text }), 'run', 'main.ista');
    expect(run).toEqual({
      code: 1,
      out: '',
      err: "ista: main.ista declares no 'live async fn main()'.\n",
    });
  });

  it('reports a spawned instance that panics on the error stream and exits 1 (§9)', async () => {
    const text = [
      "import * as runtime from 'runtime'",
      "import * as time from 'time'",
      'ista async fn bad(): panic("spawned boom")',
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
      'ista async fn _main() -> Int:',
      '  spawn bad()',
      '  await time.delay(20ms)',
      '  42',
      '',
    ].join('\n');
    const run = await ista(project({ 'main.ista': text }), 'run', 'main.ista');
    expect(run.code).toBe(1);
    expect(run.err).toContain('spawned boom');
  });

  it('reports a spawned instance that panics while the runtime serves its jobs (§9)', async () => {
    const text = [
      "import * as runtime from 'runtime'",
      "import * as time from 'time'",
      'live async fn one() -> Int: 1',
      'ista async fn bad():',
      '  await time.delay(5ms)',
      '  panic("spawned boom")',
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
      'ista async fn _main() -> Int:',
      '  spawn bad()',
      '  await time.delay(20ms)',
      '  41 + (await runtime.delegate one())',
      '',
    ].join('\n');
    const run = await ista(project({ 'main.ista': text }), 'run', 'main.ista');
    expect(run.code).toBe(1);
    expect(run.err).toContain('spawned boom');
  });

  it('reports where a context waits when main calls it under an explicit key and nothing can wake it (§9)', async () => {
    const text = [
      "import * as runtime from 'runtime'",
      'ista async fn stuck() -> Int:',
      '  const s = Slot.create<Int>()',
      '  @Waypoint{"stuck-slot"}',
      '  const v = await s.take()',
      '  v',
      'live async fn main() -> Int: await runtime.run("o/1") stuck()',
      '',
    ].join('\n');
    const run = await ista(project({ 'main.ista': text }), 'run', 'main.ista');
    expect(run.code).toBe(1);
    expect(run.err).toContain('stuck-slot');
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
  "import * as time from 'time'\nimport * as runtime from 'runtime'",
  'live async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():',
  '  const start = time.now()',
  '  log.info("waiting")',
  '  await time.delay(300ms)',
  '  time.now().value - start.value >= 300',
  '',
].join('\n');

const runLine = /^ista: run (?<name>\S+)$/mu;
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
  it('resumes a context killed while it waits once the program runs again on the store', async () => {
    const root = project({ 'main.ista': waitingProgram });
    const child = spawn(process.execPath, [builtCli, 'run', '--store', 'store', 'main.ista'], {
      cwd: root,
    });
    const exited = new Promise((done) => child.on('exit', done));
    // A context writes a log record once its segment committed, so the store holds it by then.
    const err = await errorStreamUntil(child, committedLog);
    const name = runLine.exec(err)?.groups?.name ?? '';
    const stored = join(root, 'store', 'instances', `${name}.json`);
    expect(readFileSync(stored, 'utf8')).toContain('"kind":"execution"');
    child.kill();
    await exited;
    const again = await ista(root, 'run', '--store', 'store', 'main.ista');
    expect(again.code).toBe(0);
    expect(again.out).toBe('true\n');
    // The killed run's context went on where it committed, and gave its call's answer to nobody.
    const resumed = readFileSync(stored, 'utf8');
    expect(resumed).not.toContain('"kind":"execution"');
    expect(resumed).not.toContain('"kind":"answer"');
  });

  it.each([
    ['no entry', []],
    ['the --resume it no longer has', ['main.ista', '--store', 's', '--resume', 'x']],
  ])('is a usage error to give %s', async (_case, args) => {
    const run = await ista(project({ 'main.ista': waitingProgram }), 'run', ...args);
    expect(run.code).toBe(2);
    expect(run.out).toBe('');
  });
});
