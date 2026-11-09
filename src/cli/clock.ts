/** The CLI's one clock, real time: what segments start at, and sleeping until a timer is due. */

import { setTimeout as sleep } from 'node:timers/promises';
import type { Clock } from '../runtime/host/clock.ts';

const now = (): bigint => BigInt(Date.now());

export const clock: Clock = {
  now,
  until: (at) => sleep(Math.max(0, Number(at - now()))),
};
