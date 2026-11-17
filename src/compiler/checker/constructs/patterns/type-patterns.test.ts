/**
 * Type patterns (§3.11) as properties: a bare PascalCase name in a pattern refers, never binds, and
 * a type pattern on an `any` value matches exactly the values converted from that type. The
 * corpus (test/corpus/patterns/type-patterns.ista) runs the rules one case at a time.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { slowTestTimeout } from '../../../../../test/timeouts.ts';
import { startToEnd, testRuntime } from '../../../../runtime/runtime.test-kit.ts';
import { entityOfName, stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { compiledEncoded } from '../../../compile.test-kit.ts';

const words = /^[a-z ]{0,6}$/u;
const letters = /^[a-z]{1,6}$/u;
const pascalNames = /^_?[A-Z][A-Za-z0-9]{0,6}$/u;

/** The types a value is made of, each with literals of it written from generated seeds. */
const typedValues: readonly (readonly [string, fc.Arbitrary<string>])[] = [
  ['Int', fc.integer({ min: -99, max: 99 }).map(String)],
  ['Float', fc.integer({ min: -99, max: 99 }).map((whole) => `${whole}.5`)],
  ['Bool', fc.boolean().map(String)],
  ['String', fc.stringMatching(words).map((text) => `"${text}"`)],
  ['Email', fc.stringMatching(letters).map((to) => `Email{to: "${to}"}`)],
];

const testedTypes = typedValues.map(([type]) => type);

const emailDeclarations = [
  'struct Email { to: String }',
  'fn toString(self: Email) -> String: self.to',
].join('\n');

describe('type patterns', () => {
  it('match exactly the values converted from their type into an any', {
    timeout: slowTestTimeout,
  }, async () => {
    const converted = fc.oneof(
      ...typedValues.map(([type, literals]) => literals.map((literal) => ({ type, literal }))),
    );
    await fc.assert(
      fc.asyncProperty(converted, async ({ type, literal }) => {
        const main = [
          emailDeclarations,
          "import * as runtime from 'runtime'\nlive async fn main() -> Array<Bool>: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Array<Bool>:",
          `  const value: any Stringable = ${literal}`,
          `  [${testedTypes.map((tested) => `value is ${tested}`).join(', ')}]`,
        ].join('\n');
        expect(await startToEnd(testRuntime(), compiledEncoded(main))).toEqual({
          kind: 'finished',
          outcome: JSON.stringify(testedTypes.map((tested) => tested === type)),
        });
      }),
      { numRuns: 30 },
    );
  });

  it('never bind a PascalCase bare name', () => {
    fc.assert(
      fc.property(fc.stringMatching(pascalNames), (name) => {
        const program = stdProgramOf({
          main: `fn f(x: Int) -> Int:\n  match x:\n    case ${name}: 1\n    case _: 2\n`,
        });
        expect(entityOfName(program, 'main', name, 0)?.kind).not.toBe('variable');
      }),
    );
  });
});
