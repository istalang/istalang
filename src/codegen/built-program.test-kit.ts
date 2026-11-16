/**
 * A Definition built as `ista build` builds it, inside the package, and loaded, for the benchmarks:
 * what they time is the build (`dist/`), which Node loads itself (vitest.config.ts), the emitted
 * module importing the runtime library as `istalang/live` from inside the package.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll } from 'vitest';
import type { Definition } from '../definition/definition.ts';
import type { LiveProgram } from '../live/program.ts';
import { emitProgram } from './emit.ts';

/** `definition` emitted into a folder under `dist/`, removed after the file's tests, and loaded. */
export async function builtProgram(definition: Definition): Promise<LiveProgram> {
  const emitted = emitProgram(definition, { runtime: 'istalang/live' });
  if (emitted.kind === 'refused') {
    throw new Error(emitted.problem);
  }
  const folder = mkdtempSync(fileURLToPath(new URL('../../dist/bench-', import.meta.url)));
  afterAll(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  const file = join(folder, 'program.mjs');
  writeFileSync(file, emitted.text);
  return ((await import(pathToFileURL(file).href)) as { readonly default: LiveProgram }).default;
}
