/**
 * Appending to a string (§3.9): any Stringable value appends the text its `toString` writes, on
 * either side of a string, a primitive and a program's own type alike.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mainGives } from './prelude.test-kit.ts';

/** The string `main` gives, returning `expression` beside `declarations`. */
async function appended(expression: string, declarations = ''): Promise<unknown> {
  return await mainGives('String', expression, declarations);
}

describe('appending to a string', () => {
  it('appends an int on either side, as its toString writes it', async () => {
    await fc.assert(
      fc.asyncProperty(fc.bigInt(), async (value) => {
        expect(await appended(`"<" + ${value} + "|" + (${value} + ">")`)).toBe(
          `<${value}|${value}>`,
        );
      }),
      { numRuns: 10 },
    );
  });

  it("appends a program's own Stringable type, a float and a bool on either side", async () => {
    const money =
      'struct Money { cents: Int }\nfn toString(self: Money) -> String: String(self.cents) + "c"';
    expect(
      await appended(
        'Money{cents: 5} + " and " + 1.5 + ", " + (true + "") + Money{cents: 2}',
        money,
      ),
    ).toBe('5c and 1.5, true2c');
  });
});
