/**
 * Times and durations as ISO 8601 text (§3.8, §9), in milliseconds since the Unix epoch and
 * milliseconds.
 *
 * - A time is written as JavaScript's `Date.toJSON` writes it: UTC, with milliseconds, and the
 *   six-digit signed year JavaScript uses outside 0000–9999. Beyond the instants a JavaScript
 *   `Date` can hold, ±8.64e15 ms, there is no such text, so writing one is refused.
 * - A duration is written as `Temporal.Duration` writes the exact time between two instants:
 *   hours at most, since a day is a calendar unit that isn't always 24 hours, as `PT1H30M`, with
 *   seconds carrying any milliseconds (`PT0.25S`), `PT0S` for none, and `-` before a negative one.
 * - Reading accepts what writing gives, plus a UTC offset instead of `Z` and a time without
 *   milliseconds; a duration may also count days, read as 24 hours each. Calendar units (years,
 *   months, weeks) have no fixed length, and anything finer than a millisecond can't be held, so
 *   both are refused rather than rounded.
 */

import {
  hoursPerDay,
  millisecondsPerDay,
  millisecondsPerHour,
  millisecondsPerMinute,
  millisecondsPerSecond,
  minutesPerHour,
  secondsPerMinute,
} from '../../language/time-units.ts';

/** The furthest a JavaScript `Date` reaches from the epoch, either way. */
const maximumTime = 8_640_000_000_000_000n;
/** How many digits a millisecond count has as a fraction of a second. */
const millisecondDigits = 3;

const timeSyntax =
  /^(?<year>[+-]\d{6}|\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<fraction>\d{1,3}))?(?<zone>Z|(?<sign>[+-])(?<zoneHour>\d{2}):(?<zoneMinute>\d{2}))$/u;
const durationSyntax =
  /^(?<sign>[+-])?P(?:(?<days>\d+)D)?(?:T(?:(?<hours>\d+)H)?(?:(?<minutes>\d+)M)?(?:(?<seconds>\d+)(?:[.,](?<fraction>\d{1,3}))?S)?)?$/u;
const anyDigit = /\d/u;
const trailingZeros = /0+$/u;

/** `time` as `Date.toJSON` writes it; undefined beyond what a JavaScript `Date` can hold. */
export function timeText(time: bigint): string | undefined {
  return time < -maximumTime || time > maximumTime
    ? undefined
    : new Date(Number(time)).toISOString();
}

/** The time `text` names, in milliseconds since the epoch; undefined for text that isn't one. */
export function readTime(text: string): bigint | undefined {
  const parts = timeSyntax.exec(text)?.groups;
  if (parts === undefined) {
    return undefined;
  }
  const [month = 0, day = 0, hour = 0, minute = 0, second = 0] = [
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ].map(Number);
  const date = new Date(0);
  date.setUTCFullYear(Number(parts.year), month - 1, day);
  date.setUTCHours(hour, minute, second, Number(fractionOf(parts.fraction)));
  const offset = zoneOffset(parts);
  const isCalendarTime =
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    BigInt(hour) < hoursPerDay &&
    BigInt(minute) < minutesPerHour &&
    BigInt(second) < secondsPerMinute;
  if (!isCalendarTime || Number.isNaN(date.getTime()) || offset === undefined) {
    return undefined;
  }
  return BigInt(date.getTime()) - offset;
}

/** `duration` milliseconds as `Temporal.Duration` writes the time between two instants. */
export function durationText(duration: bigint): string {
  const sign = duration < 0n ? '-' : '';
  const magnitude = duration < 0n ? -duration : duration;
  const hours = magnitude / millisecondsPerHour;
  const minutes = (magnitude % millisecondsPerHour) / millisecondsPerMinute;
  const seconds = (magnitude % millisecondsPerMinute) / millisecondsPerSecond;
  const milliseconds = magnitude % millisecondsPerSecond;
  const digits = String(milliseconds).padStart(millisecondDigits, '0').replace(trailingZeros, '');
  const fraction = milliseconds === 0n ? '' : `.${digits}`;
  const parts = [
    hours === 0n ? '' : `${hours}H`,
    minutes === 0n ? '' : `${minutes}M`,
    seconds === 0n && fraction === '' ? '' : `${seconds}${fraction}S`,
  ].join('');
  return `${sign}PT${parts === '' ? '0S' : parts}`;
}

/** The milliseconds `text` names as a duration; undefined for text that isn't one. */
export function readDuration(text: string): bigint | undefined {
  const parts = durationSyntax.exec(text)?.groups;
  if (parts === undefined || !anyDigit.test(text) || text.endsWith('T')) {
    return undefined;
  }
  const magnitude =
    BigInt(parts.days ?? '0') * millisecondsPerDay +
    BigInt(parts.hours ?? '0') * millisecondsPerHour +
    BigInt(parts.minutes ?? '0') * millisecondsPerMinute +
    BigInt(parts.seconds ?? '0') * millisecondsPerSecond +
    fractionOf(parts.fraction);
  return parts.sign === '-' ? -magnitude : magnitude;
}

/** The milliseconds of a fraction of a second written with up to three digits. */
function fractionOf(digits = ''): bigint {
  return BigInt(digits.padEnd(millisecondDigits, '0'));
}

/** The milliseconds a time's zone is ahead of UTC; undefined for an offset past 23:59. */
function zoneOffset(parts: Partial<Record<string, string>>): bigint | undefined {
  if (parts.zone === 'Z') {
    return 0n;
  }
  const hours = BigInt(parts.zoneHour ?? '0');
  const minutes = BigInt(parts.zoneMinute ?? '0');
  if (hours >= hoursPerDay || minutes >= minutesPerHour) {
    return undefined;
  }
  const offset = hours * millisecondsPerHour + minutes * millisecondsPerMinute;
  return parts.sign === '-' ? -offset : offset;
}
