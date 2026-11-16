/**
 * A Definition built as `ista build` builds it, inside the package, and loaded, for the benchmarks:
 * what they time is the build (`dist/`), which Node loads itself (vitest.config.ts), the module
 * importing the runtime library as `istalang/live` from inside the package.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll } from 'vitest';
import { builtModule, emitProgram } from '../codegen/emit.ts';
import { type EncodedDefinition, embeddedText } from '../definition/definition.ts';
import type { LiveProgram } from './program.ts';

/** `encoded` built into a folder under `dist/`, removed after the file's tests, and loaded. */
export async function builtProgram(encoded: EncodedDefinition): Promise<LiveProgram> {
  const text = builtModule(embeddedText(encoded), emitProgram(encoded.definition));
  const folder = mkdtempSync(fileURLToPath(new URL('../../dist/bench-', import.meta.url)));
  afterAll(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  const file = join(folder, 'program.mjs');
  writeFileSync(file, text);
  return ((await import(pathToFileURL(file).href)) as { readonly default: LiveProgram }).default;
}
