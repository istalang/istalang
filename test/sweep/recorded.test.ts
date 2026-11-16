/** Each group's goldens record subjects that are still there (checks/golden.ts). */

import { expect, it } from 'vitest';
import { subjectGroups } from '../golden/subjects.ts';
import { goldensOf } from './checks/golden.ts';

it.each([...subjectGroups])('%s goldens record no subject that is gone', (group, subjects) => {
  const names = new Set(subjects.map(({ name }) => name));
  expect(Object.keys(goldensOf(group).recorded).filter((name) => !names.has(name))).toEqual([]);
});
