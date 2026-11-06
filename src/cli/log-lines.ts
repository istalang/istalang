/**
 * A log record (§3.8 `log`) as the CLI writes it: one line of canonical JSON, its time as ISO 8601
 * text, so `ista run`'s error stream and `ista test`'s failures read alike (§9, §10).
 */

import { encodeJson } from '../definition/formats/codec.ts';
import type { LogRecord } from '../runtime/instance-state.ts';
import { timeText } from '../stdlib/time/iso.ts';

/** `record` as one line of JSON, without its line break. */
export function logLine(record: LogRecord): string {
  return encodeJson({ ...record, time: timeText(record.time) ?? record.time });
}
