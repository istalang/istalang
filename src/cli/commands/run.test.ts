/**
 * `ista run` end to end. Every program of test/corpus/run (run-programs.ts) runs through the CLI
 * in-process and must have the outcome it states, so the whole pipeline (checker, lowering,
 * runtime, boundary) is what's tested.
 */

import { describe, expect, it } from 'vitest';
import { runCorpusDirectory as corpus, runPrograms } from '../../../test/corpus/run-programs.ts';
import { subsetOutcome, subsetSource } from '../../../test/definitions/subset.ts';
import { ista, tempProject as project } from '../cli.test-kit.ts';

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

  it('refuses an outcome JSON has no form for, without a stack trace', async () => {
    const text = 'async fn main(): 1e308 * 10.0\n';
    const run = await ista(project({ 'main.ista': text }), 'run', 'main.ista');
    expect(run).toEqual({ code: 1, out: '', err: 'ista: The float Infinity has no JSON form.\n' });
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
