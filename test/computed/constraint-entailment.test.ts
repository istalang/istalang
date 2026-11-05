/**
 * A type known only per instantiation meets a struct constraint exactly when its own struct
 * constraints imply it (docs/proposals/4-computed-types.md §2, spec §3.5): each field the expected
 * constraint names is named by its own, with a rule implying the entry's; and, when the expected
 * one constrains its other fields, every field its own names beyond that and every field its own
 * leaves to its `[_]` entry meet it. Nested struct constraints imply alike, at any depth.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { codesOf } from './computed.test-kit.ts';

const traits = [
  'trait Show:',
  '  fn show(self: Self) -> String',
  'trait Size:',
  '  fn size(self: Self) -> Int',
  'fn show(self: Int) -> String: ""',
  'fn show(self: String) -> String: self',
  'fn size(self: Int) -> Int: self',
  'fn size(self: Bool) -> Int: 1',
];

/** The diagnostics of passing a value meeting `given` where `needed` is expected. */
function passing(given: string, needed: string): readonly number[] {
  return codesOf(
    ...traits,
    `fn needs<S is ${needed}>(s: S): ()`,
    `fn gives<S is ${given}>(s: S): needs(s)`,
  );
}

const refused = [checkerDiagnostics.notConforming.code];

describe('a struct constraint implied by another', () => {
  it.each([
    ['struct { a is Show; [_] is Show & Size }', 'struct { [_] is Show }'],
    ['struct { a: Int; [_] is Show }', 'struct { a is Show & Size; [_] is Show }'],
    ['struct { a: Int } & struct { [_] is Show }', 'struct { a: Int; [_] is Show }'],
    ['struct { [_] is struct { x: Int } }', 'struct { [_] is struct { x: Int } }'],
    [
      'struct { [_] is struct { x: Int; [_] is Show } }',
      'struct { [_] is struct { [_] is Show } }',
    ],
    ['struct { a is struct { x: Int; y: Bool } }', 'struct { a is struct { y: Bool } }'],
    ['struct { a: Int; b: String }', 'struct'],
  ])('%s meets %s', (given, needed) => {
    expect(passing(given, needed)).toEqual([]);
  });

  it.each([
    ['struct { a is Show }', 'struct { a is Size }'],
    ['struct { a: Bool; [_] is Show }', 'struct { [_] is Show }'],
    ['struct { a: Int }', 'struct { a: Int; b: Int }'],
    ['struct { a: Int }', 'struct { [_] is Show }'],
    ['struct { [_] is struct { x: Int } }', 'struct { [_] is struct { x: Int; [_] is Show } }'],
    ['struct { a is struct { x: Int } }', 'struct { a is struct { x: String } }'],
  ])('%s is refused where %s is expected', (given, needed) => {
    expect(passing(given, needed)).toEqual(refused);
  });
});

/** A field's rule as a struct constraint entry writes it, from a few traits and exact types. */
const ruleArbitrary = fc.constantFrom(': Int', ': Bool', ' is Show', ' is Size', ' is Show & Size');

/** A struct constraint over fields `a` and `b`, each maybe named, with maybe a `[_]` entry. */
const constraintArbitrary = fc
  .record({
    a: fc.option(ruleArbitrary, { nil: undefined }),
    b: fc.option(ruleArbitrary, { nil: undefined }),
    others: fc.option(ruleArbitrary, { nil: undefined }),
  })
  .map(({ a, b, others }) => {
    const entries = [
      ...(a === undefined ? [] : [`a${a}`]),
      ...(b === undefined ? [] : [`b${b}`]),
      ...(others === undefined ? [] : [`[_]${others}`]),
    ];
    return entries.length === 0 ? 'struct' : `struct { ${entries.join('; ')} }`;
  });

/** A struct value over fields `a`, `b` and `c`, each of a few types. */
const valueArbitrary = fc.subarray(['a', 'b', 'c']).chain((names) =>
  fc.tuple(...names.map(() => fc.constantFrom('1', 'true', '"s"'))).map((values) => {
    const fields = names.map((name, index) => `${name}: ${values[index]}`);
    return `struct{${fields.join(', ')}}`;
  }),
);

/** Whether the struct `value` meets the struct constraint `constraint`. */
function meets(constraint: string, value: string): boolean {
  const codes = codesOf(
    ...traits,
    `fn takes<S is ${constraint}>(s: S): ()`,
    `fn f(): takes(${value})`,
  );
  return codes.length === 0;
}

describe('implying a struct constraint', () => {
  it('is sound: every struct meeting the given constraint meets the needed one', () => {
    fc.assert(
      fc.property(
        constraintArbitrary,
        constraintArbitrary,
        fc.array(valueArbitrary, { minLength: 1, maxLength: 3 }),
        (given, needed, values) => {
          fc.pre(passing(given, needed).length === 0);
          const meeting = values.filter((value) => meets(given, value));
          expect(meeting.filter((value) => !meets(needed, value))).toEqual([]);
        },
      ),
      { numRuns: 60 },
    );
  });
});
