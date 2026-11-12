/**
 * A diagnostic leaving its phase: its span placed in its own module's tree, and each related
 * location in the tree of the module it stands in, which may be another.
 */

import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import { type AnchoredSpan, diagnosticIn, type Segment } from './positions.ts';

describe('diagnosticIn', () => {
  it("places its span in its tree, and each related location in its own module's", () => {
    const own: Segment = { kind: 'body' };
    const other: Segment = { kind: 'body' };
    const trees = { a: { bases: new Map([[own, 100]]) }, b: { bases: new Map([[other, 7]]) } };
    const diagnostic: Diagnostic<AnchoredSpan, 'a' | 'b'> = {
      code: 5720,
      severity: 'error',
      message: 'A cycle.',
      span: { segment: own, from: 1, to: 2 },
      related: [
        { module: 'b', span: { segment: other, from: 0, to: 3 }, message: 'written here' },
        { module: 'a', span: { segment: own, from: 4, to: 5 }, message: 'and here' },
      ],
    };
    expect(diagnosticIn(trees.a, diagnostic, (module) => trees[module])).toEqual({
      code: 5720,
      severity: 'error',
      message: 'A cycle.',
      span: { start: 101, end: 102 },
      related: [
        { module: 'b', span: { start: 7, end: 10 }, message: 'written here' },
        { module: 'a', span: { start: 104, end: 105 }, message: 'and here' },
      ],
    });
  });
});
