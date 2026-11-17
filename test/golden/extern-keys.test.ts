/**
 * The std's extern keys, as `extern-keys.txt` beside this test holds them, one line each: a store
 * and a host's tables keep a key across deploys and refuse a program whose spelling of one changed
 * (docs/arch/definition.md, "Externs"; lowering/tables/extern-keys.ts).
 *
 * - Before 1.0 no store has to outlive a change of spelling, so the test writes the keys as the std
 *   spells them now, and a diff of the file shows the change. From 1.0 on it fails on any
 *   difference.
 * - The std's keys only: a program's externs are spelled by the same rules, so its keys change
 *   only where a std key would.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { packageVersion } from '../../src/cli/package-version.ts';
import { compareOrdered } from '../../src/foundation/language/order.ts';
import { stdExterns } from '../../src/stdlib/std-externs.test-kit.ts';

const file = new URL('./extern-keys.txt', import.meta.url);

/** Whether the keys stored are held: from 1.0 on (the banner). */
const held = Number.parseInt(packageVersion(), 10) >= 1;

it('spells every std extern as stored', () => {
  const keys = stdExterns().externs.map(({ key }) => key);
  const spelled = `${[...new Set(keys)].toSorted(compareOrdered).join('\n')}\n`;
  if (!held) {
    writeFileSync(file, spelled);
  }
  expect(readFileSync(file, 'utf8')).toBe(spelled);
});
