/**
 * Reading a literal's raw text agrees with swc's parser on generated escapes, maps every boundary
 * back into the raw text, and reads back whatever spelling writes.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cook, type Quote, spell } from './escapes.ts';
import { literalGroupsOf } from './literals.ts';

const quotes: readonly Quote[] = ["'", '"', '`'];

/** Characters each kind of literal treats specially, and others of every width. */
const tricky = ['\\', "'", '"', '`', '$', '{', '}', '\n', '\r', '\u2028', '\0', 'a', '‸', '😀'];

const text = fc.string({ unit: fc.oneof(fc.constantFrom(...tricky), fc.string({ maxLength: 1 })) });

/** Raw spellings a literal of any kind may hold, escapes of every form among them. */
const rawUnits = [
  'a',
  '‸',
  '😀',
  ' ',
  '$',
  '{',
  '\\n',
  '\\r',
  '\\t',
  '\\b',
  '\\f',
  '\\v',
  '\\0',
  '\\\\',
  "\\'",
  '\\"',
  '\\`',
  '\\$',
  '\\x41',
  '\\u00e9',
  '\\u{1F600}',
  '\\u{41}',
  '\\\n',
  '\\\r\n',
  '\\q',
  '\\‸',
];

const raw = fc.array(fc.constantFrom(...rawUnits)).map((units) => units.join(''));

/** What swc reads `raw` as, inside a `'` literal. */
function swcReading(rawText: string): string | undefined {
  return literalGroupsOf(`x = '${rawText}';`)[0]?.[0]?.parts[0]?.cooked;
}

describe('cook', () => {
  it('reads raw text as swc reads it', () => {
    fc.assert(
      fc.property(raw, (rawText) => {
        expect(cook(rawText, "'")?.text).toBe(swcReading(rawText));
      }),
    );
  });

  it('maps each stretch between two boundaries to raw text reading as that stretch', () => {
    fc.assert(
      fc.property(raw, fc.nat(), fc.nat(), (rawText, first, second) => {
        const cooked = cook(rawText, "'");
        const bounds = Array.from({ length: (cooked?.text.length ?? 0) + 1 }, (_, index) => index);
        const [start = 0, end = 0] = [first % bounds.length, second % bounds.length].toSorted(
          (a, b) => a - b,
        );
        const rawStart = cooked?.offsets[start];
        const rawEnd = cooked?.offsets[end];
        fc.pre(rawStart !== undefined && rawEnd !== undefined);
        expect(cook(rawText.slice(rawStart, rawEnd), "'")?.text).toBe(
          cooked?.text.slice(start, end),
        );
      }),
    );
  });

  it('leaves the boundary inside one escape spelling two units nowhere', () => {
    expect(cook('a\\u{1F600}b', "'")?.offsets).toEqual([0, 1, undefined, 10, 11]);
  });

  it('reads a carriage return in a template as a line feed, as the language does', () => {
    expect(cook('a\r\nb\rc', '`')).toEqual({ text: 'a\nb\nc', offsets: [0, 1, 3, 4, 5, 6] });
  });

  it('refuses legacy octal escapes, which no module may hold', () => {
    expect(cook('\\1', "'")).toBeUndefined();
    expect(cook('\\01', "'")).toBeUndefined();
  });
});

describe('spell', () => {
  it('writes what reads back as the text, for every kind of literal', () => {
    fc.assert(
      fc.property(text, fc.constantFrom(...quotes), (written, quote) => {
        const spelled = spell(written, quote) ?? '';
        expect(cook(spelled, quote)?.text).toBe(written);
        expect(literalGroupsOf(`x = ${quote}${spelled}${quote};`)[0]?.[0]?.parts.length).toBe(1);
      }),
    );
  });

  it('refuses text that would open a substitution with a template character beside it', () => {
    expect(spell('{x}', '`', '$', '')).toBeUndefined();
    expect(spell('a$', '`', '', '{')).toBeUndefined();
    expect(spell('', '`', '$', '{')).toBeUndefined();
    expect(spell('{x}', "'", '$', '')).toBe('{x}');
  });
});
