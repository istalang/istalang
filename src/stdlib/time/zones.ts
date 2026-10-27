/**
 * The `time` module's time-zone natives (time.ista, §3.8): readings of times in IANA zones, through
 * Temporal, from temporal-polyfill since Node 22 has none. Its zone rules are the host's time-zone
 * data.
 *
 * - A DateTime holds what Temporal's PlainDateTime does, to the millisecond, under the same field
 *   names, read and built by name. Text with a finer fraction is refused rather than rounded, as
 *   `Time.parse` refuses it (iso.ts).
 * - A Zone holds its canonical id, which only `Zone.parse` and `utc` make, so every zone a native
 *   is given exists, unless a snapshot moved to a host whose zone data lacks it, which panics.
 *   `DateTime.parse` refuses a date that doesn't exist, so one reaches the other natives only in a
 *   struct the program built itself, which panics (§3.12), as a reading beyond the years Temporal
 *   holds does.
 * - An offset is written to the minute, as ISO 8601 writes one, so a time before a zone's
 *   standard offsets, whose local mean time runs to the second, reads back seconds apart.
 */

import { Temporal } from 'temporal-polyfill';
import type { NamedFields } from '../../definition/declared-values.ts';
import type { Value } from '../../definition/values.ts';
import { wellKnown } from '../../language/well-known.ts';
import { type NativeContext, type Natives, Panic } from '../../runtime/natives.ts';
import {
  fieldNamed,
  int,
  okExtern,
  okStruct,
  parseResult,
  resultExtern,
  resultStruct,
  text,
  textPayloadOf,
} from '../native-values.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';
import { millisecondsOf, resultMilliseconds } from './fields.ts';

const timeType = knownTypeKey(wellKnown.time);

/** The fields of a PlainDateTime a DateTime holds, which time.ista names as Temporal does. */
const dateTimeFields = ['year', 'month', 'day', 'hour', 'minute', 'second', 'millisecond'] as const;

type DateTimeField = (typeof dateTimeFields)[number];

/** What `read` gives for each DateTime field, by name. */
function eachField<T>(read: (field: DateTimeField) => T): Record<DateTimeField, T> {
  // Object.fromEntries types its keys as any string; these are exactly `dateTimeFields`.
  return Object.fromEntries(dateTimeFields.map((field) => [field, read(field)])) as Record<
    DateTimeField,
    T
  >;
}

/** How many digits ISO 8601 writes each field with, at the least. */
const fieldDigits = {
  year: 4,
  month: 2,
  day: 2,
  hour: 2,
  minute: 2,
  second: 2,
  millisecond: 3,
} satisfies Record<DateTimeField, number>;

/** How Temporal writes the id of a zone that is a fixed UTC offset: `+01:00`. */
const utcOffset = /^[+-]\d{2}:\d{2}$/u;

/** The canonical id of Coordinated Universal Time, as Temporal writes it. */
const utcId = 'UTC';

export const zoneNatives = (keys: NativeKeys): Natives<NativeContext> => {
  const zoneType = keys.type('Zone');
  const dateTimeType = keys.type('DateTime');
  return {
    [keys.of('utc')]: (_, context) => resultExtern(context, utcId),
    [keys.ofStatic('Zone', 'parse', 'string')]: ([source], context) => {
      const id = canonicalZone(text(source));
      const zone = id === undefined ? undefined : okExtern(context, id);
      return parseResult(context, text(source), 'an IANA time zone', zone);
    },
    [keys.of('toString', zoneType)]: ([zone]) => textPayloadOf(zone),
    [keys.of('toString', dateTimeType)]: ([dateTime], context) =>
      plainOf(context, dateTime).toString(),
    [keys.ofStatic('DateTime', 'parse', 'string')]: ([source], context) => {
      const read = readPlain(text(source));
      const dateTime = read === undefined ? undefined : okStruct(context, fieldsOf(read));
      return parseResult(context, text(source), 'an ISO 8601 date and time', dateTime);
    },
    [keys.of('weekday', dateTimeType)]: ([dateTime], context) =>
      BigInt(plainOf(context, dateTime).dayOfWeek),
    [keys.of('addDays', dateTimeType, 'int')]: ([dateTime, days], context) => {
      const plain = plainOf(context, dateTime);
      const later = withinRange(`The date ${int(days)} days after ${plain}`, () =>
        plain.add({ days: Number(int(days)) }),
      );
      return resultStruct(context, fieldsOf(later));
    },
    [keys.of('inZone', timeType, zoneType)]: ([time, zone], context) =>
      resultStruct(context, fieldsOf(zonedOf(context, time, zone).toPlainDateTime())),
    [keys.ofStatic(wellKnown.time.name, 'of', dateTimeType, zoneType)]: (
      [dateTime, zone],
      context,
    ) => {
      const plain = plainOf(context, dateTime);
      const id = zoneIdOf(zone);
      const zoned = withinRange(`${plain} in ${id}`, () =>
        plain.toZonedDateTime(id, { disambiguation: 'compatible' }),
      );
      return resultMilliseconds(context, BigInt(zoned.epochMilliseconds));
    },
    [keys.of('format', timeType, zoneType)]: ([time, zone], context) =>
      zonedOf(context, time, zone).toString({ timeZoneName: 'never', fractionalSecondDigits: 3 }),
  };
};

/**
 * The canonical id of the IANA zone `id` names, in any case; undefined when it names none.
 * Temporal also reads a fixed UTC offset as a zone, which no IANA name is.
 */
function canonicalZone(id: string): string | undefined {
  const canonical = unlessRefused(
    () => Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(id).timeZoneId,
  );
  return canonical === undefined || utcOffset.test(canonical) ? undefined : canonical;
}

/**
 * A DateTime's text read as Temporal reads one; undefined when it doesn't exist or is finer than a
 * millisecond.
 */
function readPlain(source: string): Temporal.PlainDateTime | undefined {
  const read = unlessRefused(() => Temporal.PlainDateTime.from(source, { overflow: 'reject' }));
  return read?.microsecond === 0 && read.nanosecond === 0 ? read : undefined;
}

/** The zone a `Zone` argument names; a panic when this host's zone data has none by its id. */
function zoneIdOf(zone: Value | undefined): string {
  const id = textPayloadOf(zone);
  if (canonicalZone(id) === undefined) {
    throw new Panic(`'${id}' is no IANA time zone on this host.`);
  }
  return id;
}

/** A `Time` argument read in the zone a `Zone` argument names. */
function zonedOf(
  context: NativeContext,
  time: Value | undefined,
  zone: Value | undefined,
): Temporal.ZonedDateTime {
  const milliseconds = millisecondsOf(context, time);
  const id = zoneIdOf(zone);
  return withinRange(`The time ${milliseconds} ms from the epoch`, () =>
    Temporal.Instant.fromEpochMilliseconds(Number(milliseconds)).toZonedDateTimeISO(id),
  );
}

/** A `DateTime` argument as Temporal holds one; a panic when it is no date and time. */
function plainOf(context: NativeContext, dateTime: Value | undefined): Temporal.PlainDateTime {
  const fields = eachField((field) => Number(int(fieldNamed(context, dateTime, field))));
  const read = unlessRefused(() => Temporal.PlainDateTime.from(fields, { overflow: 'reject' }));
  if (read === undefined) {
    throw new Panic(`There is no date and time ${writtenFields(fields)}.`);
  }
  return read;
}

/** A PlainDateTime's fields as a DateTime holds them. */
function fieldsOf(dateTime: Temporal.PlainDateTime): NamedFields {
  return eachField((field) => BigInt(dateTime[field]));
}

/** Fields that make no date and time, written as ISO 8601 would write them if they did. */
function writtenFields(fields: Record<DateTimeField, number>): string {
  const { year, month, day, hour, minute, second, millisecond } = eachField((field) =>
    String(fields[field]).padStart(fieldDigits[field], '0'),
  );
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}`;
}

/** What `read` gives, or a panic saying that `what` is out of the range Temporal holds. */
function withinRange<T>(what: string, read: () => T): T {
  const result = unlessRefused(read);
  if (result === undefined) {
    throw new Panic(`${what} is out of range.`);
  }
  return result;
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
