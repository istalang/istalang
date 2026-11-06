/**
 * The scanner as a whole: totality and losslessness over arbitrary and hostile text, words, trivia,
 * line starts, tabs, unknown characters, and every example in the spec.
 *
 * Totality and losslessness are checked as properties, because the inputs that break a scanner are
 * the ones nobody writes by hand. Spec examples are read from docs/spec.md at test time. Examples
 * that use `…` as a placeholder are checked to fail only on the placeholder.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { specExamples } from '../../../test/corpus/spec-examples.ts';
import { reportedOnce } from '../../foundation/diagnostics/diagnostic.test-kit.ts';
import { textOf } from '../../foundation/text/span.ts';
import { keywords } from '../syntax/tokens/index.ts';
import { scannerDiagnostics } from './diagnostics.ts';
import {
  anyUtf16,
  fragmentSoup,
  kindsAndTexts,
  lexemes,
  losslessnessViolations,
  scanMalformed,
  scannedPast,
  scanText,
  soleToken,
} from './scan.test-kit.ts';

const { tabIndentation, unexpectedCharacter } = scannerDiagnostics;

describe('totality and losslessness', () => {
  it('never throws and covers arbitrary UTF-16 text exactly', () => {
    fc.assert(
      fc.property(anyUtf16, (text) => {
        expect(losslessnessViolations(scanText(text))).toEqual([]);
      }),
    );
  });

  it('covers random mixes of valid and malformed lexemes exactly', () => {
    fc.assert(
      fc.property(fragmentSoup, (text) => {
        expect(losslessnessViolations(scanText(text))).toEqual([]);
      }),
    );
  });

  it('ends every scan with exactly one end token', () => {
    fc.assert(
      fc.property(fragmentSoup, (text) => {
        const kinds = scanText(text).tokens.map((token) => token.kind);
        expect(kinds.filter((kind) => kind === 'end')).toEqual(['end']);
        expect(kinds.at(-1)).toBe('end');
      }),
    );
  });
});

describe('words', () => {
  it.each(keywords)('scans the keyword %s', (keyword) => {
    expect(soleToken(keyword)?.kind).toBe(keyword);
  });

  it.each(['type', 'from', 'sendable', 'self', 'Self', '_', 'int', 'userId', 'Pair2', '_private'])(
    'scans %s as an identifier (§2)',
    (word) => {
      expect(soleToken(word)?.kind).toBe('identifier');
    },
  );

  it('reads the longest identifier, so keywords inside words stay words', () => {
    expect(kindsAndTexts(scanText('format inner isOk fnName'))).toEqual([
      ['identifier', 'format'],
      ['identifier', 'inner'],
      ['identifier', 'isOk'],
      ['identifier', 'fnName'],
    ]);
  });
});

describe('comments and whitespace', () => {
  it('keeps comments apart from tokens, up to the line break', () => {
    const scanned = scanText('x # note\r\ny');
    expect(scanned.comments.map((comment) => textOf(scanned.source, comment.span))).toEqual([
      '# note',
    ]);
    expect(kindsAndTexts(scanned)).toEqual([
      ['identifier', 'x'],
      ['identifier', 'y'],
    ]);
  });

  it('reports a byte order mark past the start of a file', () => {
    expect(scanMalformed('x \uFEFF')).toEqual(
      scannedPast(reportedOnce(unexpectedCharacter.code, '\uFEFF')),
    );
  });
});

describe('line starts', () => {
  const line = fc.array(fc.constantFrom('a', 'fn', '1', '(', '"s"'), { maxLength: 4 });
  const lineBreak = fc.constantFrom('\n', '\r\n', '\r');

  it('marks exactly the first token of each line, plus the end token', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(line, lineBreak), { maxLength: 8 }), (lines) => {
        const text = lines.map(([words, ending]) => `  ${words.join(' ')} # c${ending}`).join('');
        const expected = lines.flatMap(([words]) => words.map((_, index) => index === 0));
        expect(scanText(text).tokens.map((token) => token.firstOnLine)).toEqual([
          ...expected,
          true,
        ]);
      }),
    );
  });
});

describe('tabs (§2)', () => {
  it.each([
    ['\tx', '\t'],
    ['  \t  x', '\t'],
  ])('reports a tab in the indentation of %j', (input, spanText) => {
    expect(scanMalformed(input)).toEqual(scannedPast(reportedOnce(tabIndentation.code, spanText)));
  });

  it('reports one diagnostic per line, at the first tab', () => {
    const scanned = scanText('\t\tx\n\ty');
    expect(scanned.diagnostics.map((diagnostic) => diagnostic.span.start)).toEqual([0, 4]);
  });

  it.each([
    ['between tokens', 'x\ty'],
    ['on a comment-only line', '\t# note\nx'],
    ['on a blank line', '\t\nx'],
  ])('accepts a tab %s', (_, text) => {
    expect(scanText(text).diagnostics).toEqual([]);
  });
});

describe('unknown characters', () => {
  it.each([
    ['€', '€'],
    ['😀', '😀'],
    ['\\', '\\'],
  ])('reports %j as one unexpected run', (input, spanText) => {
    expect(scanMalformed(input)).toEqual(
      scannedPast(reportedOnce(unexpectedCharacter.code, spanText)),
    );
  });

  it('groups a run of unknown characters into one token', () => {
    const scanned = scanText('€€😀¡ x');
    expect(kindsAndTexts(scanned)).toEqual([
      ['unknown', '€€😀¡'],
      ['identifier', 'x'],
    ]);
    expect(scanned.diagnostics).toHaveLength(1);
  });

  it('keeps a surrogate pair together and a lone surrogate alone', () => {
    const loneSurrogate = String.fromCharCode(0xd8_00);
    const scanned = scanText(`😀 ${loneSurrogate}`);
    expect(lexemes(scanned).map((token) => token.span)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 4 },
    ]);
  });
});

describe('spec examples', () => {
  const complete = specExamples.filter((example) => !example.elided);
  const elided = specExamples.filter((example) => example.elided);

  it.each(complete)('scans the example at $document:$line cleanly', ({ code }) => {
    expect(scanText(code).diagnostics).toEqual([]);
  });

  it.each(elided)(
    'scans the elided example at $document:$line, flagging only the elisions',
    ({ code }) => {
      const scanned = scanText(code);
      const flagged = scanned.diagnostics.map(
        (diagnostic) => `${diagnostic.code} ${textOf(scanned.source, diagnostic.span)}`,
      );
      expect(flagged.length).toBeGreaterThan(0);
      expect(new Set(flagged)).toEqual(new Set([`${unexpectedCharacter.code} …`]));
    },
  );
});
