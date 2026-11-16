/**
 * Times and durations as ISO 8601 text (time.ista) against an independent implementation over
 * JavaScript's `Date` and regexes (iso-oracle.test-kit.ts): every value writes as the oracle writes
 * it and reads back, and any text reads as the oracle reads it. Many cases run in one program, which
 * writes each result as text.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mainGives } from '../prelude/prelude.test-kit.ts';
import { durationText, readDuration, readTime, timeText } from './iso-oracle.test-kit.ts';

const declarations = `import Time, Duration from 'time'
fn read<T is Parsable & Stringable>(text: String) -> String:
  match T.parse(text):
    case Ok(value): "ok " + String(value)
    case Err(error): error.code + ": " + error.message`;

/** What the program giving the array of `lines`, each an expression giving a String, gives. */
async function istalang(lines: readonly string[]): Promise<unknown> {
  return await mainGives('Array<String>', `[\n${lines.join('\n')}\n]`, declarations);
}

/** What `read` gives for `text`, by the oracle reading it as `read` does and writing what it read. */
function oracleRead(
  text: string,
  read: (text: string) => bigint | undefined,
  write: (value: bigint) => string | undefined,
  what: string,
): string {
  const value = read(text);
  return value === undefined
    ? `parse: '${text}' is not an ISO 8601 ${what}.`
    : `ok ${write(value) ?? ''}`;
}

const jsTime = fc.bigInt({ min: -8_640_000_000_000_000n, max: 8_640_000_000_000_000n });

/** Text near the shapes a time and a duration take, to read as the oracle does. */
const nearTime = fc.stringMatching(
  /^[+-]?\d{0,7}-?\d{1,2}-?\d{1,2}T?\d{1,2}:?\d{1,2}:?\d{1,2}(?:\.\d{0,4})?(?:Z|[+-]\d{1,2}:\d{1,2})?$/u,
);
const nearDuration = fc.stringMatching(/^[+-]?P?(?:\d{0,3}[DHMSWY]?)?T?(?:\d{0,3}[DHMS.,]){0,4}$/u);

describe('ISO 8601 times', () => {
  it('write as Date.toJSON does, and read back what they write', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(jsTime, { minLength: 30, maxLength: 30 }), async (times) => {
        const lines = times.map((time) => `read<Time>(String(Time{value: ${time}}))`);
        const expected = times.map((time) => `ok ${new Date(Number(time)).toJSON()}`);
        expect(await istalang(lines)).toEqual(expected);
      }),
      { numRuns: 3 },
    );
  });

  it('read any text as the oracle does', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(nearTime, { minLength: 40, maxLength: 40 }), async (texts) => {
        const lines = texts.map((text) => `read<Time>("${text}")`);
        expect(await istalang(lines)).toEqual(
          texts.map((text) => oracleRead(text, readTime, timeText, 'time')),
        );
      }),
      { numRuns: 4 },
    );
  });

  it('read an offset and a time without milliseconds, and refuse what names no instant', async () => {
    const texts = [
      '2026-10-25T14:00:00+02:00',
      '2026-10-25T12:00:00-00:30',
      '1970-01-01T00:00:00Z',
      '+275760-09-13T00:00:00.000Z',
      '-271821-04-20T00:00:00.000Z',
      '+275760-09-13T00:00:00.001Z',
      '',
      '2026-02-30T00:00:00Z',
      '2024-02-29T00:00:00Z',
      '2026-10-25',
      '2026-10-25T24:00:00Z',
      '2026-10-25T12:00:00',
      '2026-10-25T12:00:00.0000Z',
      '2026-10-25T12:00:00+24:00',
      '2026-10-25 12:00:00Z',
    ];
    expect(await istalang(texts.map((text) => `read<Time>("${text}")`))).toEqual(
      texts.map((text) => oracleRead(text, readTime, timeText, 'time')),
    );
  });
});

describe('ISO 8601 durations', () => {
  it('write as Temporal does, and read back what they write', async () => {
    const durations = fc.array(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), {
      minLength: 30,
      maxLength: 30,
    });
    await fc.assert(
      fc.asyncProperty(durations, async (values) => {
        const lines = values.map((value) => `read<Duration>(String(Duration{value: ${value}}))`);
        expect(await istalang(lines)).toEqual(values.map((value) => `ok ${durationText(value)}`));
      }),
      { numRuns: 3 },
    );
  });

  it('read any text as the oracle does', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(nearDuration, { minLength: 40, maxLength: 40 }), async (texts) => {
        const lines = texts.map((text) => `read<Duration>("${text}")`);
        expect(await istalang(lines)).toEqual(
          texts.map((text) => oracleRead(text, readDuration, durationText, 'duration')),
        );
      }),
      { numRuns: 4 },
    );
  });

  it('write hours at most, read days, and refuse calendar units and finer than milliseconds', async () => {
    const texts = ['PT1H30M', 'PT120H', 'PT0.25S', 'PT1M1.001S', 'PT0S', '-PT1S', 'P1D', 'P1DT1H'];
    const refused = [
      'PT0,5S',
      '',
      'P',
      'PT',
      'P1Y',
      'P1M',
      'P1W',
      'PT0.0001S',
      'P1DT',
      'PT1H1H',
      '1H',
    ];
    const each = [...texts, ...refused];
    expect(await istalang(each.map((text) => `read<Duration>("${text}")`))).toEqual(
      each.map((text) => oracleRead(text, readDuration, durationText, 'duration')),
    );
  });
});
