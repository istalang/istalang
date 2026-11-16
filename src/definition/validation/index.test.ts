/**
 * Validation (index.ts) refuses a Definition whose purpose names code its caller may not call
 * (foundation/language/call-rule.ts): a test's suites are what ista code calls.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../compiler/binder/bind.test-kit.ts';
import { compileTests } from '../../compiler/compile.ts';
import { withModeChanged } from '../definition.test-kit.ts';
import { definitionFormat } from '../definition.ts';

describe('the call rule over the purpose', () => {
  it("refuses a test's suite that ista code may not call", () => {
    const compiled = compileTests(
      stdProgramOf({
        'main.test.ista': [
          "import Suite, Test, test from 'testing'",
          'fn passes() -> Unit: ()',
          '@Suite{"s"}',
          'fn suite() -> Array<Test>: [test("t", passes)]',
        ].join('\n'),
      }),
    );
    if (compiled.kind !== 'compiled') {
      throw new Error(`The test module didn't compile (${compiled.kind}).`);
    }
    const { text } = definitionFormat.write(compiled.definition);
    expect(() => definitionFormat.read(text)).not.toThrow();
    expect(() =>
      definitionFormat.read(
        withModeChanged(text, { name: 'main.test.ista.suite', from: 'simple', to: 'live' }),
      ),
    ).toThrow('suite s: ista code may not call main.test.ista.suite.');
  });
});
