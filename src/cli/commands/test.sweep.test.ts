/**
 * The std modules' own suites (`src/stdlib/<module>/*.test.ista`) pass through `ista test`,
 * in-process, one module's at a time, the heaps of their instances checked by the oracle of static
 * lifetimes (runtime/lifetimes/oracle.test-kit.ts), which `npm run test:std` runs without.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { oracleFor } from '../../runtime/lifetimes/oracle.test-kit.ts';
import { istaChecked } from '../cli.test-kit.ts';

const stdlib = fileURLToPath(new URL('../../stdlib/', import.meta.url));

const modules = readdirSync(stdlib, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      readdirSync(`${stdlib}${entry.name}`).some((name) => name.endsWith('.test.ista')),
  )
  .map(({ name }) => name)
  .sort();

describe('ista test over the std suites', () => {
  it.each(modules)('passes the suites of %s', async (module) => {
    const oracle = oracleFor(module);
    const run = await istaChecked(oracle, stdlib, 'test', module);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: '' });
    expect(oracle.asExpected()).toBe(true);
  });
});
