/**
 * The `time` module's time-zone natives (time.ista, §3.8): readings of times in IANA zones, through
 * Temporal, from temporal-polyfill since Node 22 has none. Its zone rules are the host's time-zone
 * data.
 *
 * - A DateTime holds what Temporal's PlainDateTime does, to the millisecond, so text with a finer
 *   fraction is refused rather than rounded, as `Time.parse` refuses it (iso.ts).
 * - `Zone.parse` and `DateTime.parse` refuse a zone or a date that doesn't exist, so one reaches the
 *   other natives only in a struct the program built itself, which panics (§3.12).
 * - An offset is written to the minute, as ISO 8601 writes one, so a time before a zone's
 *   standard offsets, whose local mean time runs to the second, reads back seconds apart.
 */

import { Temporal } from 'temporal-polyfill';
import type { Value } from '../../definition/values.ts';
import { wellKnown } from '../../language/well-known.ts';
import { type NativeContext, type Natives, Panic } from '../../runtime/natives.ts';
import { fieldOf, int, okStruct, parseResult, resultStruct, text } from '../native-values.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';

const timeType = knownTypeKey(wellKnown.time);

/** The fields of `DateTime`, in declaration order (time.ista). */
const dateTimeFields = ['year', 'month', 'day', 'hour', 'minute', 'second', 'millisecond'] as const;

type DateTimeField = (typeof dateTimeFields)[number];

export const zoneNatives = (keys: NativeKeys): Natives<NativeContext> => {
  const zoneType = keys.type('Zone');
  const dateTimeType = keys.type('DateTime');
  return {
    [keys.ofStatic('Zone', 'parse', 'string')]: ([source], context) => {
      const id = canonicalZone(text(source));
      const zone = id === undefined ? undefined : okStruct(context, [id]);
      return parseResult(context, text(source), 'an IANA time zone', zone);
    },
    [keys.of('toString', dateTimeType)]: ([dateTime]) => plainOf(dateTime).toString(),
    [keys.ofStatic('DateTime', 'parse', 'string')]: ([source], context) => {
      const read = readPlain(text(source));
      const dateTime = read === undefined ? undefined : okStruct(context, fieldsOf(read));
      return parseResult(context, text(source), 'an ISO 8601 date and time', dateTime);
    },
    [keys.of('weekday', dateTimeType)]: ([dateTime]) => BigInt(plainOf(dateTime).dayOfWeek),
    [keys.of('addDays', dateTimeType, 'int')]: ([dateTime, days], context) => {
      const plain = plainOf(dateTime);
      const later = reading(`The date ${int(days)} days after ${plain}`, () =>
        plain.add({ days: Number(int(days)) }),
      );
      return resultStruct(context, fieldsOf(later));
    },
    [keys.of('inZone', timeType, zoneType)]: ([time, zone], context) =>
      resultStruct(context, fieldsOf(zonedOf(time, zone).toPlainDateTime())),
    [keys.ofStatic(wellKnown.time.name, 'of', dateTimeType, zoneType)]: (
      [dateTime, zone],
      context,
    ) => {
      const plain = plainOf(dateTime);
      const id = zoneIdOf(zone);
      const zoned = reading(`${plain} in ${id}`, () =>
        plain.toZonedDateTime(id, { disambiguation: 'compatible' }),
      );
      return resultStruct(context, [BigInt(zoned.epochMilliseconds)]);
    },
    [keys.of('format', timeType, zoneType)]: ([time, zone]) =>
      zonedOf(time, zone).toString({ timeZoneName: 'never', fractionalSecondDigits: 3 }),
  };
};

/** The canonical id of the IANA zone `id` names, in any case; undefined when it names none. */
function canonicalZone(id: string): string | undefined {
  return unlessRefused(
    () => Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(id).timeZoneId,
  );
}

/**
 * A DateTime's text read as Temporal reads one; undefined when it doesn't exist or is finer than a
 * millisecond.
 */
function readPlain(source: string): Temporal.PlainDateTime | undefined {
  const read = unlessRefused(() => Temporal.PlainDateTime.from(source, { overflow: 'reject' }));
  return read?.microsecond === 0 && read.nanosecond === 0 ? read : undefined;
}

/** The zone a `Zone` argument names; a panic when it names none. */
function zoneIdOf(zone: Value | undefined): string {
  const id = text(fieldOf(zone, 0));
  const canonical = canonicalZone(id);
  if (canonical === undefined) {
    throw new Panic(`'${id}' is no IANA time zone.`);
  }
  return canonical;
}

/** A `Time` argument read in the zone a `Zone` argument names. */
function zonedOf(time: Value | undefined, zone: Value | undefined): Temporal.ZonedDateTime {
  const milliseconds = int(fieldOf(time, 0));
  const id = zoneIdOf(zone);
  return reading(`The time ${milliseconds} ms from the epoch in ${id}`, () =>
    Temporal.Instant.fromEpochMilliseconds(Number(milliseconds)).toZonedDateTimeISO(id),
  );
}

/** A `DateTime` argument as Temporal holds one; a panic when it is no date and time. */
function plainOf(dateTime: Value | undefined): Temporal.PlainDateTime {
  const field = (name: DateTimeField) =>
    Number(int(fieldOf(dateTime, dateTimeFields.indexOf(name))));
  const fields = {
    year: field('year'),
    month: field('month'),
    day: field('day'),
    hour: field('hour'),
    minute: field('minute'),
    second: field('second'),
    millisecond: field('millisecond'),
  };
  const { year, month, day, hour, minute, second, millisecond } = fields;
  return reading(
    `The date and time ${year}-${month}-${day} ${hour}:${minute}:${second}.${millisecond}`,
    () => Temporal.PlainDateTime.from(fields, { overflow: 'reject' }),
  );
}

/** A DateTime's fields as a struct holds them, in declaration order. */
function fieldsOf(dateTime: Temporal.PlainDateTime): Value[] {
  return dateTimeFields.map((field) => BigInt(dateTime[field]));
}

/** What `read` gives, or a panic saying that `what` doesn't exist when Temporal refuses it. */
function reading<T>(what: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw error instanceof RangeError
      ? new Panic(`${what} doesn't exist (${error.message})`)
      : error;
  }
}

/**
 * What `read` gives; undefined when Temporal refuses with a RangeError, its way of saying a value
 * doesn't exist. Anything else it throws is a bug and propagates.
 */
function unlessRefused<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (error) {
    if (error instanceof RangeError) {
      return undefined;
    }
    throw error;
  }
}
