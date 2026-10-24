/**
 * Real projects on disk for the CLI's tests: each is a fresh temporary directory, removed after the
 * test that made it, so tests exercise the file system the way users will.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';

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
