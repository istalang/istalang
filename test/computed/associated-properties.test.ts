/**
 * Properties of associated types and struct constraints (docs/proposals/4-computed-types.md §1,
 * §2) over generated inputs: an associated type read on a generic type, then instantiated, is the
 * type written with the argument in place (commutation, test/AGENTS.md), at compile time and at run
 * time; and a struct meets a struct constraint exactly when every field its entries cover does.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import {
  codesOf,
  compareWrittenTypes,
  type GeneratedField,
  generatedFieldsArbitrary,
  runMain,
  sameComputedType,
} from './computed.test-kit.ts';

/** A type argument, as written, and a value of it. */
const argument = fc.constantFrom(
  { type: 'Int', value: '3' },
  { type: 'String', value: '"s"' },
  { type: 'Bool', value: 'true' },
  { type: '"a" | "b"', value: '"b"' },
  { type: 'Int?', value: 'none' },
);

/** An associated type's body over `T`, and how a value of it is built from a `T`. */
const body = fc.constantFrom(
  { written: (t: string) => t, value: (v: string) => v },
  { written: (t: string) => `Array<${t}>`, value: (v: string) => `[${v}]` },
  { written: (t: string) => `(${t}, ${t})`, value: (v: string) => `(${v}, ${v})` },
  { written: (t: string) => `{ only: ${t} }`, value: (v: string) => `struct{only: ${v}}` },
);

describe('an associated type of a generic type (§1)', () => {
  it('instantiated is the type written with the argument in place', () => {
    fc.assert(
      fc.property(argument, body, (given, shape) => {
        const declarations = ['struct Holder<T>:', `  type Data = ${shape.written('T')}`];
        const written = shape.written(`(${given.type})`);
        expect(compareWrittenTypes(`Holder<${given.type}>.Data`, written, declarations)).toEqual(
          sameComputedType,
        );
      }),
      { numRuns: 40 },
    );
  });

  it('runs a generic body reading it as the body written for the argument does', () => {
    fc.assert(
      fc.property(argument, body, (given, shape) => {
        const written = shape.written(`(${given.type})`);
        const declarations = [
          'struct Holder<T>:',
          `  type Data = ${shape.written('T')}`,
          'fn echo<T>(data: Holder<T>.Data) -> Holder<T>.Data: data',
          `fn direct(data: ${written}) -> ${written}: data`,
        ];
        const run = [
          `const data: ${written} = ${shape.value(given.value)}`,
          `echo<${given.type}>(data) == direct(data)`,
        ].join('\n  ');
        expect(runMain('Bool', run, declarations)).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});

/** The fields, as a `struct{…}` literal writes them. */
function literalOf(fields: readonly GeneratedField[]): string {
  return `struct{${fields.map((field) => `${field.name}: ${field.value}`).join(', ')}}`;
}

/** What checking a call of `needs` on the literal of `fields` reports. */
function reportedFor(constraint: string, fields: readonly GeneratedField[]): readonly number[] {
  return codesOf(`fn needs<S is ${constraint}>(s: S): ()`, `fn use(): needs(${literalOf(fields)})`);
}

const notMet = [checkerDiagnostics.unmetStructConstraint.code];

describe('meeting a struct constraint (§2)', () => {
  it('holds exactly when every field the others entry covers meets it', () => {
    fc.assert(
      fc.property(generatedFieldsArbitrary, (fields) => {
        const allInts = fields.every((field) => field.type === 'Int');
        expect(reportedFor('struct { [_]: Int }', fields)).toEqual(allInts ? [] : notMet);
        expect(reportedFor('struct { [_] is Stringable }', fields)).toEqual([]);
        expect(reportedFor('struct', fields)).toEqual([]);
      }),
      { numRuns: 30 },
    );
  });

  it('holds for a named entry exactly when the field is there with its type, the rest open', () => {
    fc.assert(
      fc.property(generatedFieldsArbitrary, (fields) => {
        const zeta = fields.find((field) => field.name === 'zeta');
        expect(reportedFor('struct { zeta: Int }', fields)).toEqual(
          zeta === undefined ? notMet : [],
        );
        const othersInts = fields.every((field) => field.name === 'alpha' || field.type === 'Int');
        const alpha = fields.some((field) => field.name === 'alpha');
        expect(reportedFor('struct { alpha: String, [_]: Int }', fields)).toEqual(
          alpha && othersInts ? [] : notMet,
        );
      }),
      { numRuns: 30 },
    );
  });

  it('is met by a constrained type parameter whose own constraint states as much', () => {
    const declarations = [
      'fn inner<S is struct { title: String, [_]: Int }>(s: S) -> String: s.title',
      'fn outer<S is struct { title: String, count: Int, [_]: Int }>(s: S) -> String: inner(s)',
      'fn wider<S is struct { title: String }>(s: S) -> String: inner(s)',
    ];
    expect(codesOf(...declarations.slice(0, 2))).toEqual([]);
    expect(codesOf(declarations[0] ?? '', declarations[2] ?? '')).toEqual(notMet);
    const call = 'outer(struct{title: "t", count: 1, extra: 2})';
    expect(runMain('String', call, declarations.slice(0, 2))).toBe('t');
  });

  it('names an associated type after a struct in a type, which it lacks', () => {
    expect(codesOf('struct P { x: Int }', 'const p: P.Q = P{x: 1}')).toEqual([
      checkerDiagnostics.noAssociatedType.code,
    ]);
  });
});
