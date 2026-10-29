/**
 * The CLI end to end, on real files in a temporary project: in-process through `runCli` for each
 * behaviour, and once through the `ista` executable to cover the process boundary.
 */

import { chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { tempProject as project } from '../project/project.test-kit.ts';
import { builtCli, ista, istaProcess } from './cli.test-kit.ts';

const summaryOfOneError = /1 error, 0 warnings\.\n$/u;
const otherPeoplesCode = /node_modules|vendor|hidden/u;
const versionNumber = /^\d+\.\d+\.\d+/u;

const valid = {
  'main.ista': "import helper from 'lib/helper'\n\nasync fn main(): helper()\n",
  'lib/helper.ista': "import main from '../main'\n\nfn helper() -> int: 1\n",
};

describe('ista check', () => {
  it('succeeds silently on a valid multi-module project', async () => {
    expect(await ista(project(valid), 'check', 'main.ista')).toEqual({ code: 0, out: '', err: '' });
  });

  it('fails on a syntax error in an imported module, showing where', async () => {
    const root = project({ ...valid, 'lib/helper.ista': 'fn helper() -> int: 1 +\n' });
    const run = await ista(root, 'check', 'main.ista');
    expect(run.code).toBe(1);
    expect(run.out).toContain('lib/helper.ista:1:24: error 2001: ');
    expect(run.out).toContain(' 1 | fn helper() -> int: 1 +\n');
    expect(run.out).toMatch(summaryOfOneError);
  });

  it('fails on a name error across modules, showing where', async () => {
    const main = "import helper, missing from 'lib/helper'\n\nasync fn main(): helper()\n";
    const run = await ista(project({ ...valid, 'main.ista': main }), 'check');
    expect(run.code).toBe(1);
    expect(run.out).toContain(
      "main.ista:1:16: error 4009: Module 'lib/helper.ista' exports no 'missing'.",
    );
    expect(run.out).toMatch(summaryOfOneError);
  });

  it('fails on an import that names no module', async () => {
    const run = await ista(project({ 'main.ista': "import x from './gone'\n" }), 'check');
    expect(run.code).toBe(1);
    expect(run.out).toContain("main.ista:1:15: error 3000: No module is named './gone'.");
  });

  it('checks every module of the project when given no files, skipping other code', async () => {
    const root = project({
      'a.ista': '',
      'nested/b.ista': 'fn b(: 1\n',
      'node_modules/pkg/c.ista': 'broken (',
      'vendor/dep/d.ista': 'broken (',
      '.hidden/e.ista': 'broken (',
    });
    const run = await ista(root, 'check');
    expect(run.code).toBe(1);
    expect(run.out).toContain('nested/b.ista:1:');
    expect(run.out).not.toMatch(otherPeoplesCode);
  });

  it('skips only the vendor folder at the project root, not one deeper in', async () => {
    const root = project({
      'vendor/dep/d.ista': 'broken (',
      'procurement/vendor/e.ista': 'fn e(: 1\n',
    });
    const run = await ista(root, 'check');
    expect(run.out).toContain('procurement/vendor/e.ista:1:');
    expect(run.out).not.toContain('vendor/dep');
  });

  it('cannot run when the system refuses to read an imported module', async ({ skip }) => {
    skip(process.getuid?.() === 0, 'root reads files regardless of their permissions');
    const root = project({ 'main.ista': "import a from './a'\n", 'a.ista': '' });
    chmodSync(join(root, 'a.ista'), 0o000);
    const run = await ista(root, 'check', 'main.ista');
    expect(run.code).toBe(2);
    expect(run.err).toContain('ista: EACCES');
  });

  it('is a usage error to name a file that does not exist', async () => {
    expect(await ista(project(valid), 'check', 'main.ista', 'nope.ista')).toEqual({
      code: 2,
      out: '',
      err: 'ista: no such file: nope.ista\n',
    });
  });
});

describe('ista', () => {
  it('prints its version', async () => {
    const run = await ista(project({}), '--version');
    expect(run.code).toBe(0);
    expect(run.out).toMatch(versionNumber);
  });

  it('is a usage error to run an unknown command', async () => {
    const run = await ista(project({}), 'compile');
    expect(run.code).toBe(2);
    expect(run.err).toContain("unknown command 'compile'");
  });

  it('runs as the built executable, exiting with the code of the command', () => {
    expect(existsSync(builtCli), 'the test setup builds dist/cli/main.js').toBe(true);
    const run = istaProcess(project({ 'main.ista': 'fn f(: 1\n' }), 'check');
    expect(run.code).toBe(1);
    expect(run.out).toContain('main.ista:1:');
  });
});
