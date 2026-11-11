/**
 * A host's externs are unmarked or live (proposal 8, Rule 9; spec §3.6): only the runtime runs ista
 * code or fills an ista future, so a host's extern marked `ista`, generic over its mark, or holding
 * an ista value, is refused at its name, and only so, while a std module's, the runtime's own, is
 * not.
 */

import { describe, expect, it } from 'vitest';
import { binderDiagnostics } from '../../../binder/diagnostics.ts';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

describe("a host's extern", () => {
  it.each([
    ['marked ista', 'extern ista fn stamp(u: String) -> Int', 'stamp'],
    ['generic over its mark', 'extern K fn tick<K in Persistence>() -> Int', 'tick'],
  ])('is refused %s', (_case, text, name) => {
    expect(reported(text)).toEqual({
      codes: [checkerDiagnostics.hostExternMark.code],
      spanTexts: [name],
    });
  });

  it('is refused, and only so, unmarked but holding an ista future', () => {
    expect(reported('extern fn fetch(u: String) -> Future<Int, "ista">')).toEqual({
      codes: [checkerDiagnostics.hostExternMark.code],
      spanTexts: ['fetch'],
    });
  });

  it('naming a mark that is no type is told only that', () => {
    expect(reported('extern Bogus fn fetch() -> Int').codes).toEqual([
      binderDiagnostics.undeclared.code,
    ]);
  });

  it('is accepted unmarked or live', () => {
    const text = 'extern fn pure(n: Int) -> Int\nextern live async fn fetch(u: String) -> String';
    expect(reported(text)).toEqual({ codes: [], spanTexts: [] });
  });
});
