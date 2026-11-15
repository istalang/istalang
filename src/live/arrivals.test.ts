/**
 * Two events arriving together are two events (spec §6): everything the first readies runs before
 * the second is applied, and once a run stops nothing more is applied.
 */

import { describe, expect, it } from 'vitest';
import { ManualClock } from '../runtime/clock.ts';
import { Arrivals } from './arrivals.ts';

/** Settles once every turn of the event loop queued by now has run. */
function turns(count: number): Promise<void> {
  return count === 0
    ? Promise.resolve()
    : new Promise((resolve) => {
        setTimeout(() => resolve(turns(count - 1)), 0);
      });
}

describe('arrivals', () => {
  it('applies each event in a turn of its own, after what the one before readied', async () => {
    const arrivals = new Arrivals(new ManualClock());
    const seen: string[] = [];
    arrivals.arrive(() => {
      seen.push('first');
      queueMicrotask(() => seen.push('readied by first'));
    });
    arrivals.arrive(() => seen.push('second'));
    await turns(3);
    expect(seen).toEqual(['first', 'readied by first', 'second']);
  });

  it('applies nothing once stopped, a timer coming due included', async () => {
    const clock = new ManualClock();
    const arrivals = new Arrivals(clock);
    const seen: string[] = [];
    arrivals.arrive(() => {
      seen.push('first');
      arrivals.stop();
    });
    arrivals.arrive(() => seen.push('second'));
    arrivals.at(5n, () => seen.push('due'));
    await turns(3);
    expect(seen).toEqual(['first']);
  });
});
