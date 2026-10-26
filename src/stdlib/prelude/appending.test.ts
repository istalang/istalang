/**
 * Appending to a string (§3.9): any Stringable value appends the text its `toString` writes, on
 * either side of a string, a primitive and a program's own type alike.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { startToEnd, testRuntime } from '../../runtime/runtime.test-kit.ts';

/** The string `main`, returning `expression`, gives beside `declarations`. */
function appended(expression: string, declarations = ''): unknown {
  const program = `${declarations}\nasync fn main() -> Future<string>:\n  ${expression}`;
  const state = startToEnd(testRuntime(), compiledText(program));
  return state.kind === 'finished' ? JSON.parse(String(state.outcome)) : state;
}

describe('appending to a string', () => {
  it('appends an int on either side, as its toString writes it', () => {
    fc.assert(
      fc.property(fc.bigInt(), (value) => {
        expect(appended(`"<" + ${value} + "|" + (${value} + ">")`)).toBe(`<${value}|${value}>`);
      }),
      { numRuns: 10 },
    );
  });

  it("appends a program's own Stringable type, a float and a bool on either side", () => {
    const money =
      'struct Money { cents: int }\nfn toString(self: Money) -> string: string(self.cents) + "c"';
    expect(
      appended('Money{cents: 5} + " and " + 1.5 + ", " + (true + "") + Money{cents: 2}', money),
    ).toBe('5c and 1.5, true2c');
  });
});
