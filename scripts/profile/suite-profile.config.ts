/**
 * The test suite with a CPU profile per test file (suite-profile.setup.ts): vitest.config.ts as it
 * is, plus the setup file, so a profiled run runs exactly the tests a plain one does.
 *
 * Usage: npm run profile:suite -- [vitest options], then npm run profile:analyze -- .vitest/profiles '*'
 */

import { resolve } from 'node:path';
import { mergeConfig } from 'vitest/config';
import suite from '../../vitest.config.ts';

export default mergeConfig(suite, {
  root: resolve(import.meta.dirname, '../..'),
  test: { setupFiles: ['scripts/profile/suite-profile.setup.ts'] },
});
