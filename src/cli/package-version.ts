/**
 * The package's version, as its manifest states it: what `ista --version` prints, and what decides
 * whether persisted spellings may still change (test/golden/extern-keys.test.ts).
 */

import { readFileSync } from 'node:fs';

/** The manifest sits two levels up from this module, in `src` and in `dist` alike. */
export function packageVersion(): string {
  return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
}
