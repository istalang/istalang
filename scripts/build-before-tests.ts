/**
 * Builds the package before any test runs, so the CLI's end-to-end test runs the `dist` of the code
 * under test, and the exports test finds what the package ships, rather than whatever an earlier
 * build left behind. It runs `npm run build`, the one home of what a build is.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export async function setup(): Promise<void> {
  await promisify(execFile)('npm', ['run', '--silent', 'build']);
}
