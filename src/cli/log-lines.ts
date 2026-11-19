/**
 * A log record (§19.2 `log`) as the CLI writes it: one line of canonical JSON, its time as ISO 8601
 * text, as a `Time` writes it (JavaScript's `Date.toJSON`), so `ista run`'s error stream and
 * `ista test`'s failures read alike (§17.3, §18). A time no `Date` holds stays its milliseconds.
 */

import { encodeJson } from '../definition/formats/codec.ts';
import type { LogRecord } from '../runtime/instance-state.ts';

/** `record` as one line of JSON, without its line break. */
export function logLine(record: LogRecord): string {
  const date = new Date(Number(record.time));
  const time = Number.isNaN(date.getTime()) ? record.time : date.toISOString();
  return encodeJson({ ...record, time });
}
