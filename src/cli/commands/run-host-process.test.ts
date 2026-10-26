/**
 * `ista run --host` as a real process (§9): a run whose host holds a promise that never settles
 * must still end, with the documented exit code 1. In-process tests can't see this: Node ends a
 * process whose entry awaits something nothing can settle with exit code 13, so the built
 * executable is the thing to run.
 */

import { describe, expect, it } from 'vitest';
import { istaProcess, tempProject as project } from '../cli.test-kit.ts';

const nodeWarning = /unsettled top-level await/u;
const hostFailed = /^ista: the host's main\.bad\(\) failed: Error: x\n/u;
const mainStuck = /^ista: instance \S+ waits on nothing that can wake it, at /mu;

/** Runs the built `ista run main.ista --host host.mjs` on `program` and `host`, as a process. */
function runProcess(program: readonly string[], host: readonly string[]) {
  const root = project({
    'main.ista': [...program, ''].join('\n'),
    'host.mjs': ['export default {', ...host, '};', ''].join('\n'),
  });
  return istaProcess(root, 'run', 'main.ista', '--host', 'host.mjs');
}

describe('ista run --host as a process', () => {
  it("exits 1 when the host's promise fails, although another promise never settles", () => {
    const run = runProcess(
      [
        'extern fn never() -> Future<int>',
        'extern fn bad() -> Future<int>',
        'async fn main() -> Future<int>:',
        '  const pending = never()',
        '  await bad()',
      ],
      [
        "  'main.never()': () => new Promise(() => {}),",
        "  'main.bad()': () => Promise.reject(new Error('x')),",
      ],
    );
    expect(run.err).toMatch(hostFailed);
    expect(run.err).toMatch(mainStuck);
    expect(run.err).not.toMatch(nodeWarning);
    expect(run.code).toBe(1);
  });

  it("exits 1, saying where main waits, when the host's only promise never settles", () => {
    const run = runProcess(
      ['extern fn never() -> Future<int>', 'async fn main() -> Future<int>:', '  await never()'],
      ["  'main.never()': () => new Promise(() => {}),"],
    );
    expect(run.err).toMatch(mainStuck);
    expect(run.err).not.toMatch(nodeWarning);
    expect(run.code).toBe(1);
  });
});
