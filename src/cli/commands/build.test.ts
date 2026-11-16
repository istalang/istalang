/**
 * `ista build` writes one JavaScript module that a host imports and starts, its runtime library
 * reached as `istalang/live` through the package's own exports, so the module runs as a host
 * installing the package runs it, its ista code and the host's store included, kept in memory; a
 * program with errors writes nothing.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execPath } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { tempProject as project } from '../../project/project.test-kit.ts';
import { ista } from '../cli.test-kit.ts';

/** How a built module begins: importing the runtime library by its package's name. */
const importsLibrary = /^import \{ program \} from "istalang\/live";/u;
const panicked = /^panic: /u;
const reportsError = /error/u;

// Inside the package, so its module imports `istalang/live` as an installed package's would.
const outputs = mkdtempSync(
  join(fileURLToPath(new URL('../../../dist/', import.meta.url)), 'build-'),
);
afterAll(() => {
  rmSync(outputs, { recursive: true, force: true });
});

let built = 0;

/** Where a test's module is written. */
function output(): string {
  built += 1;
  return join(outputs, `program-${built}.mjs`);
}

/** What the module at `path` gives when a host starts its `main` with `start`, as JSON text. */
function started(path: string, start = '{}'): string {
  const script = `const { default: program } = await import(${JSON.stringify(pathToFileURL(path).href)});
const ended = await program.start(${start});
console.log(ended.kind === 'finished' ? ended.text : 'panic: ' + ended.message);`;
  const run = spawnSync(execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' });
  return run.stdout.trim() || run.stderr;
}

describe('ista build', () => {
  it('writes a module whose main a host starts, importing the runtime library by name', async () => {
    const root = project({
      'main.ista':
        'live async fn main() -> String: await twice(fn(n: Int) -> Int: n + 1)\nlive async fn twice(f: fn(Int) -> Int) -> String: String(f(f(1)))\n',
    });
    const out = output();
    expect(await ista(root, 'build', 'main.ista', '--out', out)).toEqual({
      code: 0,
      out: '',
      err: '',
    });
    expect(readFileSync(out, 'utf8')).toMatch(importsLibrary);
    expect(started(out)).toBe('"3"');
  });

  it("gives the host's externs to the program and its panics back", async () => {
    const root = project({
      'main.ista':
        'extern live async fn ask() -> Int\nlive async fn main() -> Int: 100 // await ask()\n',
    });
    const out = output();
    expect((await ista(root, 'build', 'main.ista', '--out', out)).code).toBe(0);
    expect(started(out, "{ externs: { 'main.ask()': () => Promise.resolve(25n) } }")).toBe('4');
    expect(started(out, "{ externs: { 'main.ask()': () => Promise.resolve(0n) } }")).toMatch(
      panicked,
    );
  });

  it('runs the ista code a context of the program runs, kept in memory', async () => {
    const root = project({
      'main.ista':
        "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) work()\nista async fn work() -> Int: 1\n",
    });
    const out = output();
    expect((await ista(root, 'build', 'main.ista', '--out', out)).code).toBe(0);
    expect(started(out)).toBe('1');
  });

  it("opens the host's store, kept in memory", async () => {
    const root = project({
      'main.ista':
        "import * as runtime from 'runtime'\nimport Runtime from 'runtime'\nlive async fn main() -> Int:\n  _ = await Runtime.open(runtime.hostStore())\n  2\n",
    });
    const out = output();
    expect((await ista(root, 'build', 'main.ista', '--out', out)).code).toBe(0);
    expect(started(out)).toBe('2');
  });

  it('writes nothing for a program with errors, reporting them', async () => {
    const root = project({ 'main.ista': 'live async fn main() -> Int: "no"\n' });
    const out = output();
    const run = await ista(root, 'build', 'main.ista', '--out', out);
    expect(run).toMatchObject({ code: 1, out: '' });
    expect(run.err).toMatch(reportsError);
    expect(existsSync(out)).toBe(false);
  });
});
