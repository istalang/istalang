/**
 * Times and durations as ISO 8601 text (§3.8): every value reads back as written, a time is
 * written exactly as JavaScript's `Date.toJSON` writes it, and text that isn't one is refused.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { durationText, readDuration, readTime, timeText } from './iso.ts';

const jsTime = fc.bigInt({ min: -8_640_000_000_000_000n, max: 8_640_000_000_000_000n });

describe('ISO 8601 times', () => {
  it('write as Date.toJSON does, and read back what they write', () => {
    fc.assert(
      fc.property(jsTime, (time) => {
        const written = timeText(time);
        expect(written).toBe(new Date(Number(time)).toJSON());
        expect(readTime(written ?? '')).toBe(time);
      }),
    );
  });

  it('have no text beyond what a Date can hold', () => {
    expect(timeText(8_640_000_000_000_001n)).toBeUndefined();
    expect(timeText(-8_640_000_000_000_001n)).toBeUndefined();
  });

  it('read an offset, and a time without milliseconds', () => {
    expect(readTime('2026-10-25T14:00:00+02:00')).toBe(readTime('2026-10-25T12:00:00.000Z'));
    expect(readTime('2026-10-25T12:00:00-00:30')).toBe(readTime('2026-10-25T12:30:00Z'));
    expect(readTime('1970-01-01T00:00:00Z')).toBe(0n);
  });

  it('refuse text that names no instant', () => {
    for (const text of [
      '',
      '2026-02-30T00:00:00Z',
      '2026-10-25',
      '2026-10-25T24:00:00Z',
      '2026-10-25T12:00:00',
      '2026-10-25T12:00:00.0000Z',
      '2026-10-25T12:00:00+24:00',
      '2026-10-25 12:00:00Z',
    ]) {
      expect(readTime(text)).toBeUndefined();
    }
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(() => readTime(text)).not.toThrow();
      }),
    );
  });
});

describe('ISO 8601 durations', () => {
  it('read back every duration as written', () => {
    fc.assert(
      fc.property(fc.bigInt(), (duration) => {
        expect(readDuration(durationText(duration))).toBe(duration);
      }),
    );
  });

  it('write hours at most, seconds carrying milliseconds, as Temporal does', () => {
    expect(durationText(5_400_000n)).toBe('PT1H30M');
    expect(durationText(432_000_000n)).toBe('PT120H');
    expect(durationText(250n)).toBe('PT0.25S');
    expect(durationText(61_001n)).toBe('PT1M1.001S');
    expect(durationText(0n)).toBe('PT0S');
    expect(durationText(-1000n)).toBe('-PT1S');
  });

  it('read days as 24 hours, and refuse calendar units and finer than milliseconds', () => {
    expect(readDuration('P1D')).toBe(86_400_000n);
    expect(readDuration('P1DT1H')).toBe(90_000_000n);
    expect(readDuration('PT0,5S')).toBe(500n);
    for (const text of ['', 'P', 'PT', 'P1Y', 'P1M', 'P1W', 'PT0.0001S', 'P1DT', 'PT1H1H', '1H']) {
      expect(readDuration(text)).toBeUndefined();
    }
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(() => readDuration(text)).not.toThrow();
      }),
    );
  });
});
