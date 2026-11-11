/**
 * Properties across every computed construct at once (docs/proposals/4-computed-types.md,
 * test/AGENTS.md): over generated structs, `keyof`, a mapped type, a field loop, a struct
 * comprehension, a rest and a key read agree with what the struct's fields say in name order; and
 * generic code using an associated type, a type `match`, a mapped type and a rest, instantiated,
 * agrees with the same code written for the type substituted, collapsing arguments included. A
 * rest through a union member an instantiation collapses reads the member's value (tracker Q41).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareOrdered } from '../../src/foundation/language/order.ts';
import { compareWrittenTypes, runMain } from '../written-types.test-kit.ts';
import { generatedFieldsArbitrary, sameComputedType } from './computed.test-kit.ts';

describe('a rest through a union member an instantiation collapses', () => {
  it('reads the member’s value whether the union collapsed or not', async () => {
    const declarations = [
      'struct Pair { first: Int, second: Int, third: Int }',
      'fn matchRestG<T>(x: T | Pair) -> Int:',
      '  match x:',
      '    case Pair{first, ...rest}: first + rest.second + rest.third',
      '    case _: 0',
      'fn matchRestM(x: Pair) -> Int:',
      '  match x:',
      '    case Pair{first, ...rest}: first + rest.second + rest.third',
      'fn matchTupleG<T>(x: T | (Pair, Int)) -> Int:',
      '  match x:',
      '    case (Pair{first, ...rest}, n): first + rest.second + rest.third + n',
      '    case _: 0',
    ];
    const body = [
      'const p = Pair{first: 10, second: 20, third: 30}',
      'const g1 = matchRestG<Pair>(p)',
      'const g2 = matchRestG<Int>(p)',
      'const m1 = matchRestM(p)',
      'const g3 = matchTupleG<(Pair, Int)>((p, 5))',
      'const g4 = matchTupleG<String>((p, 5))',
      '`${g1}:${g2}:${m1}:${g3}:${g4}`',
    ].join('\n  ');
    expect(await runMain('String', body, declarations)).toBe('60:60:60:65:65');
  });
});

describe('a struct that is also iterable', () => {
  it('iterates with `for x in s` and loops over its fields with `for k, v in ...s`', async () => {
    const declarations = [
      'struct Pairs { b: (Int, String), a: (Int, String) }',
      'fn iterate(self: Pairs) -> fn() -> Step<Int>:',
      '  let done = false',
      '  fn next() -> Step<Int>:',
      '    if done:',
      '      return Done',
      '    done = true',
      '    Next(99)',
      '  next',
    ];
    const body = [
      'const pairs = Pairs{b: (2, "two"), a: (1, "one")}',
      'let iterated = 0',
      'for x in pairs:',
      '  iterated += x',
      'let fields: Array<String> = []',
      'for k, (n, label) in ...pairs:',
      '  fields.push(`${k}:${n}:${label}`)',
      '`${iterated}|${fields.join(",")}`',
    ].join('\n  ');
    expect(await runMain('String', body, declarations)).toBe('99|a:1:one,b:2:two');
  });
});

describe('every computed construct over a generated struct', () => {
  it('agrees with its fields in name order', async () => {
    await fc.assert(
      fc.asyncProperty(generatedFieldsArbitrary, async (fields) => {
        const [first] = fields;
        if (first === undefined) {
          return;
        }
        const sorted = [...fields].sort((one, other) => compareOrdered(one.name, other.name));
        const spelled = (field: (typeof fields)[number]) => `${field.name}: ${field.type}`;
        const declarations = [
          `struct Gen { ${fields.map(spelled).join(', ')} }`,
          `type ShapeGen = { ${fields.toReversed().map(spelled).join(', ')} }`,
          'type MappedGen = { [K in keyof Gen]: Gen[K] }',
        ];
        const keys = sorted.map((field) => `"${field.name}"`).join(' | ');
        expect(compareWrittenTypes('keyof Gen', keys, declarations)).toEqual(sameComputedType);
        expect(compareWrittenTypes('MappedGen', 'ShapeGen', declarations)).toEqual(
          sameComputedType,
        );
        const body = [
          `const s = Gen{${fields.map((field) => `${field.name}: ${field.value}`).join(', ')}}`,
          'const keys = [for k, _ in ...s: k]',
          'const copied: ShapeGen = struct{for k, v in ...s: [k]: v}',
          `const struct{${first.name}, ...rest} = s`,
          `const rebuilt: ShapeGen = struct{${first.name}, for k, v in ...rest: [k]: v}`,
          `const readFirst = s["${first.name}"] == ${first.name}`,
          '`${keys.join(",")}|${copied == rebuilt}|${readFirst}`',
        ].join('\n  ');
        expect(await runMain('String', body, declarations)).toBe(
          `${sorted.map((field) => field.name).join(',')}|true|true`,
        );
      }),
      { numRuns: 20 },
    );
  });
});

describe('generic code over computed types, instantiated', () => {
  const typeArguments = fc.constantFrom(
    { type: 'Int', value: '7', other: '9' },
    { type: 'String', value: '"ok"', other: '"no"' },
    { type: 'Int?', value: 'none', other: '4' },
    { type: '"draft" | "sent"', value: '"draft"', other: '"sent"' },
    { type: 'None', value: 'none', other: 'none' },
  );

  /** Generic functions, `$` standing for the type parameters they take, or none once substituted. */
  const templates = [
    'fn assoc$(b: Box<T>) -> Box<T>.Data: b.v',
    'fn matched$(b: Box<T>) -> Unbox<Box<T>>: b.v',
    'fn mapped$(p: Pair<T>) -> { [K in keyof Pair<T>]: Pair<T>[K] }:',
    '  struct{for k, v in ...p: [k]: v}',
    'fn rest$(p: Pair<T>) -> T:',
    '  const Pair{a, ...rest} = p',
    '  rest["b"]',
  ];

  it('agrees with the same code written for the type substituted', async () => {
    await fc.assert(
      fc.asyncProperty(typeArguments, async ({ type, value, other }) => {
        const generic = templates.map((line) => line.replace('$', 'G<T>'));
        const substituted = templates.map((line) =>
          line.replace('$', 'M').replaceAll(/\bT\b/gu, `(${type})`),
        );
        const declarations = [
          'struct Box<V> { v: V, type Data = V }',
          'struct Pair<V> { b: V, a: Int }',
          'type Unbox<D> = match D:',
          '  case Box<infer V>: V',
          '  case _: Never',
          ...generic,
          ...substituted,
        ];
        const body = [
          `const b = Box<(${type})>{v: ${value}}`,
          `const p = Pair<(${type})>{b: ${other}, a: 1}`,
          `const c1 = assocG<(${type})>(b) == assocM(b)`,
          `const c2 = matchedG<(${type})>(b) == matchedM(b)`,
          `const c3 = mappedG<(${type})>(p) == mappedM(p)`,
          `const c4 = restG<(${type})>(p) == restM(p)`,
          '`${c1}:${c2}:${c3}:${c4}`',
        ].join('\n  ');
        expect(await runMain('String', body, declarations)).toBe('true:true:true:true');
      }),
      { numRuns: 15 },
    );
  });
});
