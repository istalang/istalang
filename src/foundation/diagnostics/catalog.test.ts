/**
 * The catalog helper: typed factories, codes readable without making a diagnostic, arguments read
 * back from one made, and codes rejected when they are duplicated or fall outside their phase's
 * block.
 */

import { describe, expect, it } from 'vitest';
import { defineDiagnostics } from './catalog.ts';
import { codeBlockSize, codeBlocks } from './code-blocks.ts';

describe('defineDiagnostics', () => {
  const span = { start: 3, end: 7 };

  it('makes typed factories that fill code, severity and message', () => {
    const catalog = defineDiagnostics('parser', {
      unknownName: { code: 2901, message: (name: string) => `Unknown name '${name}'.` },
      unusedLet: { code: 2902, severity: 'warning', message: () => 'Unused let.' },
    });
    expect(catalog.unknownName(span, 'x')).toEqual({
      code: 2901,
      severity: 'error',
      message: "Unknown name 'x'.",
      span,
      arguments: ['x'],
      related: [],
    });
    expect(catalog.unusedLet(span).severity).toBe('warning');
    expect(catalog.unknownName.code).toBe(2901);
  });

  it('reads the arguments back only from a diagnostic its own factory made', () => {
    const catalog = defineDiagnostics('parser', {
      unknownName: { code: 2901, message: (name: string) => `Unknown name '${name}'.` },
      unusedLet: { code: 2902, message: () => 'Unused let.' },
    });
    expect(catalog.unknownName.argumentsOf(catalog.unknownName(span, 'x'))).toEqual(['x']);
    expect(catalog.unknownName.argumentsOf(catalog.unusedLet(span))).toBeUndefined();
  });

  it('rejects a code declared twice', () => {
    expect(() =>
      defineDiagnostics('parser', {
        first: { code: 2901, message: () => 'a' },
        second: { code: 2901, message: () => 'b' },
      }),
    ).toThrow('2901');
  });

  it.each([999, 2000, 1000 + codeBlockSize])(
    'rejects code %i outside the scanner block',
    (code) => {
      expect(() => defineDiagnostics('scanner', { stray: { code, message: () => 'a' } })).toThrow(
        String(code),
      );
    },
  );
});

describe('codeBlocks', () => {
  it('gives every phase its own non-overlapping block', () => {
    const starts = Object.values(codeBlocks).toSorted((left, right) => left - right);
    for (const [index, start] of starts.entries()) {
      expect(start % codeBlockSize).toBe(0);
      expect(starts[index + 1] ?? Number.POSITIVE_INFINITY).toBeGreaterThanOrEqual(
        start + codeBlockSize,
      );
    }
  });
});
