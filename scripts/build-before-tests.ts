/**
 * Builds the package's JavaScript before any test runs, so the CLI's end-to-end test always runs
 * the `dist` of the code under test rather than whatever an earlier build left behind. It uses
 * tsdown.config.ts as the real build does; declarations are left to `npm run build`, since no test
 * needs them.
 */

import { build } from 'tsdown';

export async function setup(): Promise<void> {
  await build({ logLevel: 'silent' });
}
