/**
 * The std's extern keys are spelled as they were frozen (extern-keys.test-kit.ts); what each
 * program persists is the corpus sweep's to check (test/sweep).
 */

import { expect, it } from 'vitest';
import { frozenSpellings, stdSpellings } from './extern-keys.test-kit.ts';

it('spells every std extern as before', () => {
  expect(stdSpellings().filter((spelling) => !frozenSpellings.has(spelling))).toEqual([]);
});
