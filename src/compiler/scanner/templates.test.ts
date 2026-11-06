/**
 * Templates and docstrings (spec §2): their values' tokens, how their lines are laid out, escapes,
 * and what an unterminated one reports. Losslessness over them is a property in scan.test.ts.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../diagnostics/diagnostic.test-kit.ts';
import { textOf } from '../../text/span.ts';
import type { Token } from '../syntax/tokens/index.ts';
import { scannerDiagnostics } from './diagnostics.ts';
import { losslessnessViolations, scanMalformed, scanText, soleToken } from './scan.test-kit.ts';

const {
  invalidEscape,
  templateNestingTooDeep,
  unterminatedDocstring,
  unterminatedTemplate,
  unterminatedTemplateValue,
} = scannerDiagnostics;

const q3 = '"""';
const lineText = /^[a-z][a-z ]{0,8}$/u;

/** A template's texts and its values' source, from a text holding exactly one token. */
function templateOf(text: string): { texts: readonly string[]; values: readonly string[] } {
  const scanned = scanText(text);
  const [token] = scanned.tokens;
  if (token?.kind !== 'template') {
    throw new Error(`${text} is no template`);
  }
  const values = token.values.map((value) =>
    value.tokens
      .filter((each) => each.kind !== 'end')
      .map((each: Token) => textOf(scanned.source, each.span))
      .join(' '),
  );
  return { texts: token.texts.map((each) => each.value), values };
}

describe('templates', () => {
  it.each([
    ['`plain`', ['plain'], []],
    ['``', [''], []],
    ['`a ${x} b`', ['a ', ' b'], ['x']],
    ['`${x}${y}`', ['', '', ''], ['x', 'y']],
    ['`${ f(a, {b}) }!`', ['', '!'], ['f ( a , { b } )']],
    ['`${"}"}`', ['', ''], ['"}"']],
    ['`${`${1}`}`', ['', ''], ['`${1}`']],
    ['`$ {x} $x`', ['$ {x} $x'], []],
  ])('scans %s', (text, texts, values) => {
    expect(templateOf(text)).toEqual({ texts, values });
    expect(scanText(text).diagnostics).toEqual([]);
  });

  it.each([
    ['`\\``', '`'],
    ['`\\${x}`', '${x}'],
    ['`\\$`', '$'],
    ['`a\\nb\\u{41}`', 'a\nbA'],
  ])('decodes the escapes of %s', (text, value) => {
    expect(templateOf(text).texts).toEqual([value]);
  });

  it('keeps a value spanning lines as code, its comments among the file comments', () => {
    const scanned = scanText('`${\n  x # note\n}`\ny');
    expect(templateOf('`${\n  x # note\n}`').values).toEqual(['x']);
    expect(scanned.comments).toHaveLength(1);
    expect(scanned.tokens.at(-2)).toMatchObject({ kind: 'identifier', firstOnLine: true });
  });

  it('stands on the line it ends on', () => {
    const { tokens } = scanText('`a\nb` c');
    expect(tokens.map((token) => [token.kind, token.firstOnLine])).toEqual([
      ['template', true],
      ['identifier', false],
      ['end', true],
    ]);
  });
});

describe('the lines of a multi-line literal', () => {
  it.each([
    ['drops the line the opening ends', '`\n  a\n  b`', 'a\nb'],
    ['drops the closing line', '`\n  a\n  b\n  `', 'a\nb'],
    ['keeps relative indentation', '`\n  a\n    b\n  `', 'a\n  b'],
    ['leaves the opening line alone', '`  a\n    b`', '  a\nb'],
    ['ignores blank lines', '`\n    a\n\n    b\n`', 'a\n\nb'],
    ['writes \\r\\n as \\n', '`\r\n  a\r\n  b\r\n`', 'a\nb'],
    ['keeps a single line literal', '`  a  `', '  a  '],
    ['makes an empty template of two delimiter lines', '`\n  `', ''],
    ['counts escapes as content', '`\n\\t a\n  b`', '\t a\n  b'],
  ])('%s', (_, text, value) => {
    expect(templateOf(text).texts).toEqual([value]);
  });

  it('counts a line running into a value, and lays out every text', () => {
    expect(templateOf('`\n    ${x} a\n      b\n    `')).toEqual({
      texts: ['', ' a\n  b'],
      values: ['x'],
    });
  });

  it('removes the same indentation from every line after the first', () => {
    const line = fc.stringMatching(lineText);
    fc.assert(
      fc.property(fc.array(line, { minLength: 1, maxLength: 6 }), fc.nat(6), (lines, indent) => {
        const pad = ' '.repeat(indent);
        const text = `\`\n${lines.map((each) => pad + each).join('\n')}\n${pad}\``;
        expect(templateOf(text).texts).toEqual([lines.join('\n')]);
      }),
    );
  });
});

describe('docstrings', () => {
  it.each([
    [`${q3}One line.${q3}`, 'One line.'],
    [`${q3}Summary.\n\n    More.\n    ${q3}`, 'Summary.\n\nMore.'],
    [`${q3}\n    Raw: \\d and "quotes".\n    ${q3}`, 'Raw: \\d and "quotes".'],
    [`${q3}${q3}`, ''],
  ])('scans %j', (text, value) => {
    expect(soleToken(text)).toMatchObject({ kind: 'docstring', value });
  });

  it('scans "" as an empty string, not a docstring', () => {
    expect(soleToken('""')).toMatchObject({ kind: 'string', value: '' });
  });
});

describe('malformed', () => {
  it('reports a template with no closing backtick at its opening one', () => {
    expect(scanMalformed('`open')).toMatchObject(reportedOnce(unterminatedTemplate.code, '`'));
  });

  it('reports a value with no closing brace at its ${', () => {
    expect(scanMalformed('`a ${b')).toMatchObject(
      reportedOnce(unterminatedTemplateValue.code, '${'),
    );
  });

  it('reports a docstring with no closing delimiter at its opening one', () => {
    expect(scanMalformed(`${q3}open`)).toMatchObject(reportedOnce(unterminatedDocstring.code, q3));
  });

  it('reports a backslash ending a line of a template, and keeps the line break', () => {
    const scanned = scanText('`a\\\nb`');
    expect(scanned.diagnostics.map((each) => each.code)).toEqual([invalidEscape.code]);
    expect(templateOf('`a\\\nb`').texts).toEqual(['a\nb']);
  });

  it('reads values nested past the limit as text, and stays total', () => {
    const depth = 5000;
    const scanned = scanText(`${'`${'.repeat(depth)}1${'}`'.repeat(depth)}`);
    expect(losslessnessViolations(scanned)).toEqual([]);
    expect(scanned.diagnostics.map((each) => each.code)).toContain(templateNestingTooDeep.code);
  });

  it.each(['`${ { }`', '`${`', '`${}`', '`a${b}c${'])('stays lossless over %j', (text) => {
    expect(losslessnessViolations(scanText(text))).toEqual([]);
  });
});
