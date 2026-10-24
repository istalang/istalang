/**
 * An `.ista` import is the file's exact text: the mechanism that compiles std sources into the
 * package, exercised under the test runner with the same plugin the build uses.
 */

import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import sample from './ista-text.ista';

it('imports an .ista file as its exact text', () => {
  expect(sample).toBe(readFileSync(new URL('./ista-text.ista', import.meta.url), 'utf8'));
  expect(sample).toContain('"quoted" and \\ escaped');
});
