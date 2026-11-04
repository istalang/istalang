/**
 * Lowering trait objects (§3.10): an `any` type is an enum closed over the program, one variant
 * per type converted into it, however late lowering reaches the conversion, and its values are
 * data, so they cross a snapshot like any other value.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { corpusDirectory } from '../../../../test/corpus/programs.ts';
import type { Definition } from '../../../definition/definition.ts';
import { startToEnd, testRuntime } from '../../../runtime/runtime.test-kit.ts';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { compiledDefinition, compiledText } from '../../compile.test-kit.ts';

const named = [
  'trait Named:',
  '  fn name(self: Self) -> String',
  'struct Email { to: String }',
  'struct Sms { number: String }',
  'fn name(self: Email) -> String: self.to',
  'fn name(self: Sms) -> String: self.number',
];

function compiled(lines: readonly string[]): Definition {
  return compiledDefinition(stdProgramOf({ main: [...named, ...lines].join('\n') }), 'main');
}

/** The variants of the enum entry named `name`. */
function variantsOf(definition: Definition, name: string): readonly string[] {
  const entry = definition.types.find((each) => each.kind === 'enum' && each.name === name);
  return entry?.kind === 'enum' ? entry.variants.map((variant) => variant.name) : [];
}

/** How many targets the one `switch` of the code entry named `name` has. */
function switchTargets(definition: Definition, name: string): number | undefined {
  const entry = definition.functions.find((each) => each.name === name);
  const found =
    entry?.kind === 'code' ? entry.instructions.find((each) => each.kind === 'switch') : undefined;
  return found?.kind === 'switch' ? found.targets.length : undefined;
}

describe('lowering trait objects', () => {
  it('gives an any type a variant per type converted into it, and dispatches over every one', () => {
    const definition = compiled([
      'fn late() -> any Named & Sendable: Sms{number: "1"}',
      'async fn main():',
      '  const email: any Named = Email{to: "a"}',
      '  const sms: any Named = late()',
      '  (email.name(), sms.name())',
    ]);
    expect(variantsOf(definition, 'any main.Named')).toEqual(['main.Email', 'main.Sms']);
    expect(switchTargets(definition, 'any main.Named.name')).toBe(2);
  });

  it('runs a mixed Array<any T> the same with every segment re-run from its snapshot', () => {
    const text = compiledText(
      readFileSync(`${corpusDirectory}trait-objects/dispatch.ista`, 'utf8'),
    );
    const uninterrupted = startToEnd(testRuntime(), text);
    expect(uninterrupted.kind).toBe('finished');
    expect(startToEnd(testRuntime(), text, { crashEveryAwait: true })).toEqual(uninterrupted);
  });
});
