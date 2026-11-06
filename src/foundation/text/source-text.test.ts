/**
 * The factory is where a byte order mark leaves the toolchain; nothing else about the contents may
 * change on the way in.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createSourceText } from './source-text.ts';

const byteOrderMark = '\uFEFF';

describe('createSourceText', () => {
  it('drops one leading byte order mark and keeps everything after it', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (contents) => {
        expect(createSourceText('a.ista', `${byteOrderMark}${contents}`).text).toBe(contents);
      }),
    );
  });

  it('keeps contents without a leading byte order mark unchanged, including later ones', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (contents) => {
        const text = contents.startsWith(byteOrderMark) ? `x${contents}` : contents;
        expect(createSourceText('a.ista', text).text).toBe(text);
      }),
    );
  });

  it('keeps the path as given', () => {
    expect(createSourceText('any label', '').path).toBe('any label');
  });
});
