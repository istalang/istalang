/**
 * How a diagnostic reads in a terminal: the header a terminal can link, and a caret line that stays
 * under the span for any text and span, including tabs, multi-line spans and the end of input.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createSourceText } from '../text/source-text.ts';
import type { Span } from '../text/span.ts';
import type { Diagnostic } from './diagnostic.ts';
import { renderDiagnostic } from './render.ts';

const header = /^dir\/a\.ista:\d+:\d+: error 2001: /u;
const carets = /\^+$/u;

function rendered(text: string, start: number, end: number): string {
  const diagnostic: Diagnostic = {
    code: 2001,
    severity: 'error',
    message: 'Something is wrong.',
    span: { start, end },
    related: [],
  };
  return renderDiagnostic(createSourceText('dir/a.ista', text), diagnostic);
}

describe('renderDiagnostic', () => {
  it('heads with a 1-based path:line:column, then underlines the span on its line', () => {
    const text = 'fn f():\n    g(x, y)\n';
    const start = text.indexOf('x, y');
    expect(rendered(text, start, start + 4)).toBe(
      [
        'dir/a.ista:2:7: error 2001: Something is wrong.',
        ' 2 |     g(x, y)',
        '   |       ^^^^',
      ].join('\n'),
    );
  });

  it('underlines a span over several lines to the end of its first line', () => {
    expect(rendered('ab\r\ncd', 1, 5).split('\n').slice(1)).toEqual([' 1 | ab', '   |  ^']);
  });

  it('marks an empty span, such as the end of the input, with one caret', () => {
    expect(rendered('x +', 3, 3).split('\n').slice(1)).toEqual([' 1 | x +', '   |    ^']);
  });

  it('copies tabs before the span into the caret line', () => {
    expect(rendered('"\t" x', 4, 5).split('\n')[2]).toBe('   |  \t  ^');
  });

  it('widens the gutter to the line number', () => {
    const text = `${'\n'.repeat(11)}bad`;
    expect(rendered(text, 11, 14).split('\n').slice(1)).toEqual([' 12 | bad', '    | ^^^']);
  });

  it('never throws, and always shows one header, one source line and a caret', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.nat(), fc.nat(), (text, first, second) => {
        const [start, end] = [first, second]
          .map((offset) => offset % (text.length + 1))
          .sort((left, right) => left - right) as [number, number];
        const lines = rendered(text, start, end).split('\n');
        expect(lines[0]).toMatch(header);
        expect(lines.at(-1)).toMatch(carets);
      }),
    );
  });

  it('follows with each related location as a note in its own module', () => {
    const main = createSourceText('dir/a.ista', 'a->next = a\n');
    const other = createSourceText('dir/b.ista', 'fn link():\n  x->y = z\n');
    const diagnostic: Diagnostic<Span, 'a' | 'b'> = {
      code: 5720,
      severity: 'error',
      message: 'A cycle.',
      span: { start: 0, end: 1 },
      related: [
        { module: 'b', span: { start: 13, end: 14 }, message: 'written here' },
        { module: 'a', span: { start: 10, end: 11 }, message: 'and here' },
      ],
    };
    const sources = { a: main, b: other };
    expect(renderDiagnostic(main, diagnostic, (module) => sources[module]).split('\n')).toEqual([
      'dir/a.ista:1:1: error 5720: A cycle.',
      ' 1 | a->next = a',
      '   | ^',
      'dir/b.ista:2:3: note: written here',
      ' 2 |   x->y = z',
      '   |   ^',
      'dir/a.ista:1:11: note: and here',
      ' 1 | a->next = a',
      '   |           ^',
    ]);
  });
});
