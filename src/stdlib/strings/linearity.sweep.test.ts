/**
 * The std's string code (strings.ista, the prelude's `join`, decimal.ista's text) takes time linear
 * in the text: each runs over n and over 10n items, and the larger may take at most 15 times as
 * long, where quadratic code would take 100. Each program runs as a host runs it; it runs once to
 * compile, then is timed.
 */

import { describe, expect, it } from 'vitest';
import { compiledEncoded } from '../../compiler/compile.test-kit.ts';
import type { EncodedDefinition } from '../../definition/definition.ts';
import { startToEnd, testRuntime } from '../../runtime/runtime.test-kit.ts';

/** Each operation, as the expression giving an Int that runs it over `n` items. */
const operations: Readonly<Record<string, (n: number) => string>> = {
  split: (n) => `strings.split(strings.repeat("ab,", ${n}), ",").length()`,
  replaceAll: (n) => `strings.replaceAll(strings.repeat("ab,", ${n}), ",", ";").length()`,
  lastIndexOf: (n) => `strings.lastIndexOf(strings.repeat("ab", ${n}), "b")`,
  padStart: (n) => `strings.padStart("x", ${n}, "ab").length()`,
  format: (n) =>
    `strings.format(strings.repeat("{}", ${n}), ...strings.split(strings.repeat("a", ${n}), "")).length()`,
  join: (n) => `strings.split(strings.repeat("a", ${n}), "").join(",").length()`,
  decimal: (n) =>
    `decimalText(strings.repeat("1", ${n}) + "." + strings.repeat("2", ${n})).length()`,
};

/** The program whose `main` gives what `expression` does. */
function program(expression: string): EncodedDefinition {
  return compiledEncoded(`import * as runtime from 'runtime'
import * as strings from 'strings'
import Decimal from 'decimal'

fn decimalText(text: String) -> String:
  match Decimal.parse(text):
    case Ok(value): String(value)
    case Err(error): panic(error.message)

live async fn main() -> Int: await runtime.run(runtime.id()) _main()
ista async fn _main() -> Int: ${expression}
`);
}

/** How long running `expression` takes, once its program is compiled, and how it ended. */
async function runTime(expression: string): Promise<{ time: number; ended: string }> {
  const text = program(expression);
  const start = performance.now();
  const { kind } = await startToEnd(testRuntime(), text);
  return { time: performance.now() - start, ended: kind };
}

describe('string code', () => {
  it.each(Object.entries(operations))(
    '%s takes time linear in its text',
    async (_, run) => {
      const small = await runTime(run(4000));
      const large = await runTime(run(40_000));
      expect([small.ended, large.ended]).toEqual(['finished', 'finished']);
      expect(large.time / small.time).toBeLessThan(15);
    },
    300_000,
  );
});
