/**
 * Turns an `.ista` import into a module whose default export is the file's text, so std sources
 * are compiled into the package instead of read from disk at run time.
 *
 * The bundler (tsdown) and the test runner (vitest) both speak the Rollup plugin interface, so this
 * one plugin serves both: tests see exactly the text the published package embeds. A script run by
 * Node itself loads them the same way through a module hook (ista-text-hook.ts).
 */

import { readFileSync } from 'node:fs';

const istaFile = /\.ista$/u;

/** Whether the module at `id`, a path or URL, is an Istalang source. */
export function isIstaFile(id: string): boolean {
  return istaFile.test(id);
}

/** The JavaScript module an Istalang source at `path` loads as: its text, as the default export. */
export function istaTextModule(path: string): string {
  return `export default ${JSON.stringify(readFileSync(path, 'utf8'))};`;
}

export function istaTextPlugin() {
  return {
    name: 'ista-text',
    load(id: string) {
      return isIstaFile(id) ? { code: istaTextModule(id), moduleType: 'js' } : null;
    },
  };
}
