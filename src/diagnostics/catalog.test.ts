/**
 * The catalog helper: typed factories, codes readable without making a diagnostic, and duplicate
 * codes rejected when a catalog is defined.
 */

import { describe, expect, it } from 'vitest';
import { defineDiagnostics } from './catalog.ts';

describe('defineDiagnostics', () => {
  const span = { start: 3, end: 7 };

  it('makes typed factories that fill code, severity and message', () => {
    const catalog = defineDiagnostics({
      unknownName: { code: 9001, message: (name: string) => `Unknown name '${name}'.` },
      unusedLet: { code: 9002, severity: 'warning', message: () => 'Unused let.' },
    });
    expect(catalog.unknownName(span, 'x')).toEqual({
      code: 9001,
      severity: 'error',
      message: "Unknown name 'x'.",
      span,
    });
    expect(catalog.unusedLet(span).severity).toBe('warning');
    expect(catalog.unknownName.code).toBe(9001);
  });

  it('rejects a code declared twice', () => {
    expect(() =>
      defineDiagnostics({
        first: { code: 9001, message: () => 'a' },
        second: { code: 9001, message: () => 'b' },
      }),
    ).toThrow('9001');
  });
});
