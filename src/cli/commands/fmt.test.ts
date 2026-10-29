/**
 * `ista fmt` end to end: which files it formats, what `--check` reports, and its exit codes. What
 * the canonical format is belongs to formatter/'s tests; here a module is either formatted or not.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ista, tempProject as project } from '../cli.test-kit.ts';

const formatted = 'fn main(): 1\n';
const unformatted = 'fn main():\n    1\n';
const broken = 'fn main(:\n  1\n';

describe('ista fmt', () => {
  it('rewrites every module under the project in place, quietly', async () => {
    const root = project({ 'a.ista': unformatted, 'lib/b.ista': unformatted, 'c.ista': formatted });
    const run = await ista(root, 'fmt');
    expect(run).toEqual({ code: 0, out: '', err: '' });
    for (const file of ['a.ista', 'lib/b.ista', 'c.ista']) {
      expect(readFileSync(join(root, file), 'utf8')).toBe(formatted);
    }
  });

  it('formats only the files it is given', async () => {
    const root = project({ 'a.ista': unformatted, 'b.ista': unformatted });
    expect((await ista(root, 'fmt', 'a.ista')).code).toBe(0);
    expect(readFileSync(join(root, 'a.ista'), 'utf8')).toBe(formatted);
    expect(readFileSync(join(root, 'b.ista'), 'utf8')).toBe(unformatted);
  });

  it('with --check, lists the files that would change, writes nothing, and fails', async () => {
    const root = project({ 'a.ista': unformatted, 'c.ista': formatted });
    const run = await ista(root, 'fmt', '--check');
    expect(run).toEqual({ code: 1, out: 'a.ista\n', err: '' });
    expect(readFileSync(join(root, 'a.ista'), 'utf8')).toBe(unformatted);
  });

  it('with --check, passes when every file is formatted', async () => {
    const root = project({ 'c.ista': formatted });
    expect(await ista(root, 'fmt', '--check')).toEqual({ code: 0, out: '', err: '' });
  });

  it('reports a file with syntax errors and leaves it as it is, formatting the rest', async () => {
    const root = project({ 'a.ista': unformatted, 'bad.ista': broken });
    const run = await ista(root, 'fmt');
    expect(run.code).toBe(1);
    expect(run.err).toContain('bad.ista');
    expect(readFileSync(join(root, 'bad.ista'), 'utf8')).toBe(broken);
    expect(readFileSync(join(root, 'a.ista'), 'utf8')).toBe(formatted);
  });

  it('names a file with syntax errors by its path in the project', async () => {
    const root = project({ 'lib/bad.ista': broken });
    const run = await ista(root, 'fmt');
    expect(run.err).toContain('lib/bad.ista');
    expect(run.err).not.toContain(root);
  });

  it('writes nothing when a named file is missing, or lies under a file', async () => {
    const root = project({ 'a.ista': unformatted });
    expect(await ista(root, 'fmt', 'a.ista/sub.ista')).toEqual({
      code: 2,
      out: '',
      err: 'ista: no such file: a.ista/sub.ista\n',
    });
  });

  it('writes nothing when a named file is missing', async () => {
    const root = project({ 'a.ista': unformatted });
    const run = await ista(root, 'fmt', 'a.ista', 'missing.ista');
    expect(run).toEqual({ code: 2, out: '', err: 'ista: no such file: missing.ista\n' });
    expect(readFileSync(join(root, 'a.ista'), 'utf8')).toBe(unformatted);
  });
});
