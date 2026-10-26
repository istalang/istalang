/**
 * The CLI's tests run `ista` in-process on real projects on disk: each is a fresh temporary
 * directory, removed after the test that made it, so tests exercise the file system the way users
 * will.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import { runCli } from './cli.ts';

/** The built `ista` executable, which the test setup builds before any test runs. */
export const builtCli = fileURLToPath(new URL('../../dist/cli/main.js', import.meta.url));

const projects: string[] = [];

afterEach(() => {
  for (const root of projects.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A temporary directory holding `files`, by path relative to it; returns its absolute path. */
export function tempProject(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'ista-cli-'));
  projects.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** What one `ista` run produced. */
export interface Run {
  /** Its exit code; null for a process a signal ended, such as one past its time limit. */
  readonly code: number | null;
  readonly out: string;
  readonly err: string;
}

/** Runs `ista` with `args` in `cwd`, in-process. */
export async function ista(cwd: string, ...args: string[]): Promise<Run> {
  let out = '';
  let err = '';
  const code = await runCli(args, {
    cwd,
    write: (text) => {
      out += text;
    },
    writeError: (text) => {
      err += text;
    },
    // A test's process always has work left, so its host's promises are never given up on.
    idle: new Promise(() => undefined),
  });
  return { code, out, err };
}

/**
 * Runs the built `ista` executable with `args` in `cwd`, as a process of its own: what only a real
 * process shows, such as its exit code once nothing is left to run.
 */
export function istaProcess(cwd: string, ...args: string[]): Run {
  const run = spawnSync(process.execPath, [builtCli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 20_000,
  });
  return { code: run.status, out: run.stdout, err: run.stderr };
}
