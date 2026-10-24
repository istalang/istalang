/**
 * Turns an `.ista` import into a module whose default export is the file's text, so std sources
 * are compiled into the package instead of read from disk at run time.
 *
 * The bundler (tsdown) and the test runner (vitest) both speak the Rollup plugin interface, so this
 * one plugin serves both: tests see exactly the text the published package embeds.
 */

import { readFileSync } from 'node:fs';

const istaFile = /\.ista$/u;

export function istaTextPlugin() {
  return {
    name: 'ista-text',
    load(id: string) {
      if (!istaFile.test(id)) {
        return null;
      }
      return {
        code: `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`,
        moduleType: 'js',
      };
    },
  };
}
