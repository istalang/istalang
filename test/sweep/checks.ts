/**
 * Every check the corpus sweep makes of a compiled subject, one row each: adding a check is adding
 * a row, with what it holds of each kind of subject it checks (swept.ts).
 */

import { crashEveryAwait } from './checks/crash-every-await.ts';
import { formatting } from './checks/formatting.ts';
import { golden } from './checks/golden.ts';
import { numbering } from './checks/numbering.ts';
import { ownership } from './checks/ownership.ts';
import { realTimeRun } from './checks/real-time.ts';
import type { Check } from './swept.ts';

type CheckKind =
  | 'golden'
  | 'crashEveryAwait'
  | 'realTime'
  | 'formatting'
  | 'numbering'
  | 'ownership';

export const checks = {
  golden,
  crashEveryAwait,
  realTime: realTimeRun,
  formatting,
  numbering,
  ownership,
} satisfies Record<CheckKind, Check>;
