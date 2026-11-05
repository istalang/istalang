/**
 * An `any` member takes whole every member meeting its traits (§2 "Collapse") in every union,
 * however it was built: written, or reached by substituting type arguments into a generic one
 * (§3.5). The commutation law (test/AGENTS.md): a generic union instantiated is the union written
 * with the arguments in place, for arguments that meet the traits, that don't, and that collapse
 * the union into one member. Generic code then runs on values of the members an `any` member took
 * whole: put into the union, tested by a pattern, carried into a wider union, and an optional
 * collapsed into an `any` type that took `None` too. Written for the type an instantiation makes,
 * the same code compiles and gives the same, a type pattern and `??` looking through the `any`
 * member as the instantiation does.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sameType } from '../../src/compiler/checker/types/identity.ts';
import { typeKeys } from '../../src/compiler/checker/types/type-keys.ts';
import { compareWrittenTypes, resolveWrittenTypes, runMain } from './unions.test-kit.ts';

const declarations = [
  'struct Email { to: String }',
  'struct Plain { id: Int }',
  'trait Notifier:',
  '  fn notify(self: Self) -> String',
  'fn notify(self: Email) -> String: self.to',
  'fn toString(self: Email) -> String: self.to',
  'type Absorbing<T> = T | any Stringable',
  'type Inside<T> = Array<T | any Stringable>',
  'fn wrap<T>(x: T | any Stringable) -> T | any Stringable: x',
];

const sameNormalized = { syntaxErrors: [], same: true, sameKey: true, assignCodes: [] };

describe('an `any` member absorbing after substitution (§2, §3.5)', () => {
  it('takes a type argument meeting its traits, at any depth', () => {
    expect(compareWrittenTypes('Absorbing<String>', 'any Stringable', declarations)).toEqual(
      sameNormalized,
    );
    expect(compareWrittenTypes('Inside<Int>', 'Array<Int | any Stringable>', declarations)).toEqual(
      sameNormalized,
    );
    expect(compareWrittenTypes('Inside<Email>', 'Array<any Stringable>', declarations)).toEqual(
      sameNormalized,
    );
  });

  it('keeps a type argument that does not meet its traits beside it', () => {
    const compared = compareWrittenTypes('Absorbing<Plain>', 'any Stringable', declarations);
    expect(compared.same).toBe(false);
    expect(compareWrittenTypes('Absorbing<Plain>', 'Plain | any Stringable', declarations)).toEqual(
      sameNormalized,
    );
  });

  it('gives a generic function instantiated the values of the union written for it', () => {
    expect(
      runMain(
        'Bool',
        'const a: any Stringable = "hello"\n  wrap<String>(a) == wrap<String>("hello")',
        declarations,
      ),
    ).toBe(true);
  });
});

/** Members a generic union is written with: its parameters, types and `any` types. */
const templateMember = fc.constantFrom(
  'T',
  'U',
  'Int',
  '"a"',
  'Plain',
  'None',
  'any Stringable',
  'any Notifier',
);

/** Type arguments: meeting both traits, one, none, literals, optionals and unions of them. */
const typeArgument = fc.constantFrom(
  'Int',
  'String',
  '"a"',
  'Email',
  'Plain',
  'None',
  'Int?',
  'Email | Plain',
  'any Stringable',
  'any Notifier',
);

describe('commutation: instantiating a generic union then normalizing (test/AGENTS.md)', () => {
  it('is the union written with its arguments in place', () => {
    fc.assert(
      fc.property(
        fc.array(templateMember, { minLength: 2, maxLength: 5 }),
        typeArgument,
        typeArgument,
        (members, first, second) => {
          const template = members.join(' | ');
          const argumentOf = new Map([
            ['T', first],
            ['U', second],
          ]);
          const substituted = members
            .map((member) => {
              const argument = argumentOf.get(member);
              return argument === undefined ? member : `(${argument})`;
            })
            .join(' | ');
          const { types, syntaxErrors } = resolveWrittenTypes(
            [
              `Generic<${first}, ${second}>`,
              substituted,
              `Array<Generic<${first}, ${second}>>`,
              `Array<${substituted}>`,
            ],
            [...declarations, `type Generic<T, U> = ${template}`],
          );
          expect(syntaxErrors).toEqual([]);
          const [instantiated, written, nestedInstantiated, nestedWritten] = types;
          for (const [one, other] of [
            [instantiated, written],
            [nestedInstantiated, nestedWritten],
          ] as const) {
            expect(one !== undefined && other !== undefined && sameType(one, other)).toBe(true);
            expect(
              one !== undefined &&
                other !== undefined &&
                typeKeys.typeKey(one) === typeKeys.typeKey(other),
            ).toBe(true);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

/** A type argument as written, and values of it, as written. */
interface Argument {
  readonly text: string;
  readonly values: readonly string[];
}

const valuedArgument = fc.constantFrom<Argument>(
  { text: 'Int', values: ['3'] },
  { text: 'String', values: ['"s"'] },
  { text: '"a" | "b"', values: ['"a"'] },
  { text: 'Email', values: ['Email{to: "e"}'] },
  { text: 'Plain', values: ['Plain{id: 1}'] },
  { text: 'None', values: ['none'] },
  { text: 'Int?', values: ['3', 'none'] },
  { text: 'Int | Email', values: ['3', 'Email{to: "e"}'] },
  { text: 'any Stringable', values: ['3', '"s"', 'Email{to: "e"}'] },
  { text: 'any Sendable', values: ['3', '"s"', 'none'] },
);

/**
 * Generic functions whose unions an argument above may let an `any` member take whole: `Int`
 * meets `Shows<Int>` only, so `Int | Plain | any Shows<T>` keeps `Int` until `T = Int`; a value of
 * `T` goes into `T | Plain | any Stringable`; `T?` with `T = any Sendable` is `any Sendable`; and
 * `T | Int | String` or `T | "a" | "b"` with `T = any Stringable` is `any Stringable`, out of which
 * a pattern binds a union of the members it took whole.
 */
const generic = [
  'trait Shows<X>:',
  '  fn show(self: Self, x: X) -> String',
  'fn show(self: Int, x: Int) -> String: "i"',
  'fn tagG<T>(x: Int | Plain | any Shows<T>) -> String:',
  '  match x:',
  '    case Int as n: `int:${n}`',
  '    case Plain: "plain"',
  '    case _: "other"',
  'fn widenG<T>(x: Int | Plain) -> String: tagG<T>(x)',
  'fn plainG<T>(x: T | Plain | any Stringable) -> String:',
  '  match x:',
  '    case Plain: "plain"',
  '    case _: "other"',
  'fn intoG<T>(x: T) -> String: plainG<T>(x)',
  'fn optG<T>(x: T?) -> String:',
  '  match x:',
  '    case none: "none"',
  '    case _: "some"',
  'fn orTagG<T>(x: T?, y: T) -> String: optG<T>(x ?? y)',
  'fn eitherG<T>(x: T | Int | String) -> String:',
  '  match x:',
  '    case Int | String as v: `is:${v}`',
  '    case _: "other"',
  'fn pickG<T>(x: T | "a" | "b") -> String:',
  '  match x:',
  '    case "a" | "b" as v: `lit:${v}`',
  '    case _: "other"',
];

const quoted = /^"(?<inside>.*)"$/u;
const integer = /^\d+$/u;

/** Each call on the value `value`, written as `a`, of the generic functions with `type`, and what it gives. */
function callsOn(type: string, a: string, value: string): readonly (readonly [string, string])[] {
  const some = value === 'none' ? 'none' : 'some';
  const text = quoted.exec(value)?.groups?.inside;
  const either = integer.test(value) ? `is:${value}` : 'other';
  return [
    [`eitherG<${type}>(${a})`, text === undefined ? either : `is:${text}`],
    [`pickG<${type}>(${a})`, text === 'a' || text === 'b' ? `lit:${text}` : 'other'],
    [`intoG<${type}>(${a})`, value.startsWith('Plain') ? 'plain' : 'other'],
    [`optG<${type}>(${a})`, some],
    [`orTagG<${type}>(none, ${a})`, some],
  ];
}

/** Calls of the generic functions with `type` on values written in place, and what each gives. */
function fixedCalls(type: string): readonly (readonly [string, string])[] {
  return [
    [`tagG<${type}>(5)`, 'int:5'],
    [`tagG<${type}>(Plain{id: 1})`, 'plain'],
    [`widenG<${type}>(5)`, 'int:5'],
    [`widenG<${type}>(Plain{id: 1})`, 'plain'],
    [`optG<${type}>(none)`, 'none'],
    [`eitherG<${type}>(4)`, 'is:4'],
    [`pickG<${type}>("b")`, 'lit:b'],
  ];
}

describe('generic code on values of members an `any` member took whole (§2, §3.5)', () => {
  it('puts, tests and carries them as the value says', () => {
    fc.assert(
      fc.property(valuedArgument, ({ text, values }) => {
        const type = `(${text})`;
        const all = [
          ...values.flatMap((value, index) => callsOn(type, `a${index}`, value)),
          ...fixedCalls(type),
        ];
        const body = [
          ...values.map((value, index) => `const a${index}: ${type} = ${value}`),
          `[${all.map(([call]) => call).join(', ')}]`,
        ];
        expect(runMain('Array<String>', body.join('\n  '), [...declarations, ...generic])).toEqual(
          all.map(([, expected]) => expected),
        );
      }),
      { numRuns: 30 },
    );
  });
});

/**
 * The generic functions written for `type`: each `T` the type itself, each name its own, so a
 * program holds both.
 */
function writtenFor(type: string): readonly string[] {
  const functions = generic.slice(generic.findIndex((line) => line.startsWith('fn tagG')));
  return functions.map((line) => line.replace(genericOwn, 'W').replace(typeParameter, type));
}

/** A generic function's name and its type parameter, as its declaration and calls write them. */
const genericOwn = /G<T>/gu;
const typeParameter = /\bT\b/gu;
/** A call of a generic function with its type argument written, one level of brackets inside. */
const genericCall = /G<[^>]*(?:<[^>]*>)?[^>]*>\(/u;

describe('commutation: generic code instantiated, or written for the type it is instantiated with', () => {
  it('compiles alike and gives the same', () => {
    fc.assert(
      fc.property(valuedArgument, ({ text, values }) => {
        const type = `(${text})`;
        const all = [
          ...values.flatMap((value, index) => callsOn(type, `a${index}`, value)),
          ...fixedCalls(type),
        ].map(([call]) => call);
        const written = all.map((call) => call.replace(genericCall, 'W('));
        const body = [
          ...values.map((value, index) => `const a${index}: ${type} = ${value}`),
          `[${[...all, ...written].join(', ')}]`,
        ];
        const results = runMain('Array<String>', body.join('\n  '), [
          ...declarations,
          ...generic,
          ...writtenFor(type),
        ]);
        const given = Array.isArray(results) ? results : [];
        expect(given.slice(all.length)).toEqual(given.slice(0, all.length));
        expect(given).toHaveLength(all.length * 2);
      }),
      { numRuns: 30 },
    );
  });
});
