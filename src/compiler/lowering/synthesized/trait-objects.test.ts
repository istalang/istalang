/**
 * Lowering trait objects (§3.10): an `any` type is an enum closed over the program, one variant
 * per type converted into it, however late lowering reaches the conversion, and its values are
 * data, so they cross a snapshot like any other value. A call on a union through a trait its
 * members meet (§6) dispatches over the union's own variants, and a union converted into an `any`
 * type adds its members, not itself. A member meeting another instantiation of the trait, which
 * the trait's variance lets stand for the `any` type's, is called through that one's functions,
 * what each takes and gives converted.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { corpusDirectory } from '../../../../test/corpus/programs.ts';
import type { Definition } from '../../../definition/definition.ts';
import { startToEnd, testRuntime } from '../../../runtime/runtime.test-kit.ts';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { compiledDefinition, compiledEncoded } from '../../compile.test-kit.ts';

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
      "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():",
      '  const email: any Named = Email{to: "a"}',
      '  const sms: any Named = late()',
      '  (email.name(), sms.name())',
    ]);
    expect(variantsOf(definition, 'any{main.Named<>}')).toEqual(['#main.Email<>', '#main.Sms<>']);
    expect(switchTargets(definition, 'any{main.Named<>}.name')).toBe(2);
  });

  it("dispatches a call on a union over the union's members, and converts it member by member", () => {
    const definition = compiled([
      "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():",
      '  const contact: Email | Sms = Sms{number: "1"}',
      '  const named: any Named = contact',
      '  (contact.name(), named.name())',
    ]);
    expect(switchTargets(definition, '|<#main.Email<>,#main.Sms<>>.name')).toBe(2);
    expect(variantsOf(definition, 'any{main.Named<>}')).toEqual(['#main.Email<>', '#main.Sms<>']);
  });

  it('runs a mixed Array<any T> the same with every segment re-run from its snapshot', async () => {
    const text = compiledEncoded(
      readFileSync(`${corpusDirectory}trait-objects/dispatch.ista`, 'utf8'),
    );
    const uninterrupted = await startToEnd(testRuntime(), text);
    expect(uninterrupted.kind).toBe('finished');
    expect(await startToEnd(testRuntime(), text, { crashEveryAwait: true })).toEqual(uninterrupted);
  });
});

/** The outcome `main`, after `lines`, finishes with, as JSON text. */
async function outcomeOf(lines: readonly string[]): Promise<unknown> {
  const ended = await startToEnd(testRuntime(), compiledEncoded(lines.join('\n')));
  return ended.kind === 'finished' ? ended.outcome : ended;
}

describe('lowering a call through an instantiation standing for another (§3.10)', () => {
  it('converts what it gives into what the call through `any` gives, a tagged optional', async () => {
    expect(
      await outcomeOf([
        'trait Source<T>:',
        '  fn next(self: Self) -> T',
        'struct Counter { n: Int }',
        'fn next(self: Counter) -> Int: self.n',
        "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():",
        '  const narrow: any Source<Int> = Counter{n: 3}',
        '  const wide: any Source<Int?> = narrow',
        '  match wide.next():',
        '    case none: -1',
        '    case Int as n: n * 2',
      ]),
    ).toBe('6');
  });

  it("awaits an async member's future of its trait's argument, in the member's own types", async () => {
    expect(
      await outcomeOf([
        'trait Fetch<T>:',
        '  ista async fn fetch(self: Self) -> T',
        'struct Box { n: Int }',
        'ista async fn fetch(self: Box) -> Int: self.n',
        "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():",
        '  const source: any Fetch<Int> = Box{n: 21}',
        '  2 * await source.fetch()',
      ]),
    ).toBe('42');
  });

  it('dispatches an async member of a trait generic over its mark in the kind it is called through', async () => {
    expect(
      await outcomeOf([
        "import * as runtime from 'runtime'",
        'trait Runner<K in Persistence>:',
        '  K async fn run(self: Self) -> Int',
        'struct Job { n: Int }',
        'ista async fn run(self: Job) -> Int:',
        '  await runtime.commit()',
        '  self.n',
        'live async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():',
        '  const runner: any Runner<"ista"> = Job{n: 7}',
        '  6 * await runner.run()',
      ]),
    ).toBe('42');
  });

  it('calls the closest of the instantiations that fit, converting what it takes', async () => {
    expect(
      await outcomeOf([
        'trait Each<T>:',
        '  fn each(self: Self, f: fn(T) -> Int) -> Int',
        'struct Both { k: Int }',
        'fn each(self: Both, f: fn(Int) -> Int) -> Int: f(1)',
        'fn each(self: Both, f: fn(Int?) -> Int) -> Int: f(none)',
        'fn picked(x: Int? | String) -> Int:',
        '  match x:',
        '    case none: 10',
        '    case Int as n: n',
        '    case String: 20',
        "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():",
        '  const each: any Each<Int? | String> = Both{k: 0}',
        '  each.each(picked)',
      ]),
    ).toBe('10');
  });

  it('runs the corpus of conversions through `any` the same with every segment re-run', async () => {
    const text = compiledEncoded(
      readFileSync(`${corpusDirectory}trait-objects/variance.ista`, 'utf8'),
    );
    const uninterrupted = await startToEnd(testRuntime(), text);
    expect(uninterrupted.kind).toBe('finished');
    expect(await startToEnd(testRuntime(), text, { crashEveryAwait: true })).toEqual(uninterrupted);
  });
});
