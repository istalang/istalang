/**
 * The cursor's one view of the stream: a line break reads as `lineBreak` in a line-sensitive
 * region and stops `advance` as the end does; only `crossLineBreak` moves past it; brackets ignore
 * line breaks. And the `>=` that closes type arguments: read as `>` inside `<…>`, split when
 * consumed, and restored by `reset`.
 */

import { describe, expect, it } from 'vitest';
import { createSourceText } from '../../../text/source-text.ts';
import { scan } from '../../scanner/scan.ts';
import { Cursor } from './index.ts';

function cursorOver(text: string): Cursor {
  return new Cursor(scan(createSourceText('test.ista', text)).tokens);
}

describe('line breaks', () => {
  it('stop the cursor at a line start until the break is crossed', () => {
    const cursor = cursorOver('a\nb');
    cursor.advance();
    expect(cursor.kind).toBe('lineBreak');
    expect(cursor.advance().kind).toBe('lineBreak');
    expect(cursor.eat('identifier')).toBeUndefined();
    expect(cursor.lineStart?.kind).toBe('identifier');
    cursor.crossLineBreak();
    expect(cursor.kind).toBe('identifier');
    expect(cursor.lineStart).toBeUndefined();
  });

  it('read as nothing inside brackets', () => {
    const cursor = cursorOver('(a\nb)');
    cursor.advance();
    const kinds = cursor.within('(', () => [cursor.advance().kind, cursor.advance().kind]);
    expect(kinds).toEqual(['identifier', 'identifier']);
  });

  it('hide every token beyond them from lookahead', () => {
    const cursor = cursorOver('a b\nc');
    expect([cursor.kindAt(1), cursor.kindAt(2), cursor.kindAt(3)]).toEqual([
      'identifier',
      'lineBreak',
      'lineBreak',
    ]);
  });

  it('never stand for the end of the input', () => {
    const cursor = cursorOver('a\n');
    cursor.advance();
    expect(cursor.kind).toBe('end');
  });
});

describe('a >= closing type arguments', () => {
  it('reads as > inside <…> and leaves its = behind', () => {
    const cursor = cursorOver('<Int>= x');
    cursor.advance();
    cursor.within('<', () => {
      cursor.advance();
      expect(cursor.kind).toBe('>');
      expect(cursor.eat('>')?.span).toEqual({ start: 4, end: 5 });
    });
    expect(cursor.token).toMatchObject({ kind: '=', span: { start: 5, end: 6 } });
    expect(cursor.previousEnd).toBe(5);
    cursor.advance();
    expect(cursor.kind).toBe('identifier');
  });

  it('is restored by reset when speculation fails', () => {
    const cursor = cursorOver('a<b>=c');
    cursor.advance();
    const mark = cursor.mark();
    cursor.within('<', () => {
      cursor.advance();
      cursor.advance();
      cursor.eat('>');
    });
    cursor.reset(mark);
    cursor.advance();
    cursor.advance();
    expect(cursor.kind).toBe('>=');
  });

  it('stays a single token outside <…>', () => {
    const cursor = cursorOver('a >= b');
    cursor.advance();
    expect(cursor.kind).toBe('>=');
  });
});
