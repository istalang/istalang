/**
 * The std modules' own suites (`src/stdlib/<module>/*.test.ista`) pass through `ista test`,
 * in-process, one module's at a time, the heaps of their instances checked by the oracle of static
 * lifetimes (runtime/lifetimes/oracle.test-kit.ts), and what their natives keep by its audit
 * (native-audit.test-kit.ts), both of which `npm run test:std` runs without.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isTestModulePath } from '../../foundation/language/well-known/testing.ts';
import { nativeAudit, withNativeAudit } from '../../runtime/lifetimes/native-audit.test-kit.ts';
import { stdNativeKeeps } from '../../stdlib/std-externs.test-kit.ts';
import { istaChecked } from '../cli.test-kit.ts';

const stdlib = fileURLToPath(new URL('../../stdlib/', import.meta.url));

const modules = readdirSync(stdlib, { withFileTypes: true })
  .filter(
    (entry) => entry.isDirectory() && readdirSync(`${stdlib}${entry.name}`).some(isTestModulePath),
  )
  .map(({ name }) => name)
  .sort();

const keeps = stdNativeKeeps();

describe('ista test over the std suites', () => {
  it.each(modules)('passes the suites of %s', async (module) => {
    const audit = nativeAudit(keeps);
    const run = await istaChecked(withNativeAudit(audit), stdlib, 'test', module);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: '' });
    expect(audit.uncovered()).toEqual([]);
  });
});
