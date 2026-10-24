/**
 * Line map (§2). The round trip is a property over generated lines with every line ending,
 * including the case where a lone `\r` and a following `\n` must merge into one break. Clamping
 * follows what LSP clients send.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LineMap, lineBreakLength, lineMapOf } from './line-map.ts';
import { createSourceText } from './source-text.ts';

const lineBreaks = ['\n', '\r\n', '\r'];
const lineText = fc.string({ unit: fc.constantFrom('a', ' ', '😀', '\t'), maxLength: 8 });

describe('line map (§2)', () => {
  it('maps every offset to its line and column and back', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(lineText, fc.constantFrom(...lineBreaks)), { maxLength: 10 }),
        lineText,
        (lines, lastLine) => {
          // A '\r' ending followed by an empty line ending in '\n' is one '\r\n' break, not two.
          fc.pre(
            !lines.some(
              ([, ending], index) =>
                ending === '\r' && lines[index + 1]?.[0] === '' && lines[index + 1]?.[1] === '\n',
            ),
          );
          const text = lines.map(([line, ending]) => line + ending).join('') + lastLine;
          const map = new LineMap(text);
          expect(map.lineCount).toBe(lines.length + 1);
          let offset = 0;
          for (const [lineIndex, line] of [...lines.map(([l]) => l), lastLine].entries()) {
            for (let column = 0; column <= line.length; column += 1) {
              expect(map.positionAt(offset + column)).toEqual({ line: lineIndex, column });
              expect(map.offsetAt({ line: lineIndex, column })).toBe(offset + column);
            }
            offset += line.length + (lines[lineIndex]?.[1].length ?? 0);
          }
        },
      ),
    );
  });

  it('counts \\r\\n as one line break and a lone \\r as another', () => {
    expect(new LineMap('a\r\nb\rc\nd').lineCount).toBe(4);
    expect(lineBreakLength('\r\n', 0)).toBe(2);
    expect(lineBreakLength('\r', 0)).toBe(1);
    expect(lineBreakLength('\n', 0)).toBe(1);
    expect(lineBreakLength('a', 0)).toBe(0);
    expect(lineBreakLength('', 0)).toBe(0);
  });

  it('clamps positions and offsets outside the text the way LSP clients expect', () => {
    const map = new LineMap('ab\r\ncd');
    expect(map.positionAt(-5)).toEqual({ line: 0, column: 0 });
    expect(map.positionAt(99)).toEqual({ line: 1, column: 2 });
    expect(map.offsetAt({ line: 0, column: 99 })).toBe(2);
    expect(map.offsetAt({ line: 1, column: 99 })).toBe(6);
    expect(map.offsetAt({ line: 9, column: 0 })).toBe(6);
    expect(map.offsetAt({ line: -1, column: 5 })).toBe(0);
  });

  it('derives one line map per source object', () => {
    const source = createSourceText('a.ista', 'x\ny');
    expect(lineMapOf(source)).toBe(lineMapOf(source));
    expect(lineMapOf({ ...source })).not.toBe(lineMapOf(source));
  });
});
