/**
 * Two events arriving together are two events (spec §6): everything the first readies runs before
 * the second is applied. The clock is waited on for the earliest timer only once nothing else is to
 * apply, so a manual clock never jumps while an event waits; once a run stops, nothing is applied.
 */

import { describe, expect, it } from 'vitest';
import { ManualClock } from '../runtime/clock.ts';
import { Arrivals, type Timers } from './arrivals.ts';

/** Settles once every turn of the event loop queued by now, `count` deep, has run. */
function turns(count: number): Promise<void> {
  return count === 0
    ? Promise.resolve()
    : new Promise((resolve) => {
        setTimeout(() => resolve(turns(count - 1)), 0);
      });
}

/** Timers due at `instants`, each resolving by recording the clock's time in `seen`. */
function timersAt(clock: ManualClock, instants: bigint[], seen: string[]): Timers {
  return {
    next: () => instants[0],
    resolveDue: () => {
      seen.push(`due at ${clock.now()}`);
      instants.shift();
    },
  };
}

describe('arrivals', () => {
  it('applies each event in a turn of its own, after what the one before readied', async () => {
    const arrivals = new Arrivals(new ManualClock(), {
      next: () => undefined,
      resolveDue: () => undefined,
    });
    const seen: string[] = [];
    arrivals.arrive(() => {
      seen.push('first');
      queueMicrotask(() => seen.push('readied by first'));
    });
    arrivals.arrive(() => seen.push('second'));
    await turns(3);
    expect(seen).toEqual(['first', 'readied by first', 'second']);
  });

  it('waits on the clock for each timer in turn, only once no event is left to apply', async () => {
    const clock = new ManualClock();
    const seen: string[] = [];
    const arrivals = new Arrivals(clock, timersAt(clock, [5n, 9n], seen));
    arrivals.timersChanged();
    arrivals.arrive(() => seen.push(`event at ${clock.now()}`));
    await turns(8);
    expect(seen).toEqual(['event at 0', 'due at 5', 'due at 9']);
  });

  it('applies nothing once stopped, a timer coming due included', async () => {
    const clock = new ManualClock();
    const seen: string[] = [];
    const arrivals = new Arrivals(clock, timersAt(clock, [5n], seen));
    arrivals.arrive(() => {
      seen.push('first');
      arrivals.stop();
    });
    arrivals.arrive(() => seen.push('second'));
    arrivals.timersChanged();
    await turns(5);
    expect(seen).toEqual(['first']);
  });
});
