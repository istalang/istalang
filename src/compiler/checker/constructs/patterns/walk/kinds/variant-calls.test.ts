/**
 * Call patterns (§3.11) against the brace patterns they mean: the arguments bind to the fields as a
 * call's bind to parameters, so over generated variants and call patterns (fields by position,
 * then by name in any order, fields a call may leave out left, a last `...` leaving any, a spread
 * taking the rest field, items past the fixed fields matching the rest's), a call pattern matches
 * what the brace pattern naming the same fields matches, over generated values, and binds the same.
 * Each mistake in one is reported once, with nothing more of what it refused.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeJson } from '../../../../../../definition/formats/codec.ts';
import { startToEnd, testRuntime } from '../../../../../../runtime/runtime.test-kit.ts';
import { compiledText } from '../../../../../compile.test-kit.ts';
import { reported } from '../../../../check.test-kit.ts';

/** A variant of Int fields, the first `required` without a default, maybe ending in a rest. */
interface GeneratedVariant {
  readonly fields: number;
  readonly required: number;
  readonly hasRest: boolean;
}

/**
 * How the rest field is matched: left, taken whole by a spread, or its items by `items` patterns,
 * then maybe a spread taking the others.
 */
type RestMatch =
  | { readonly kind: 'left' }
  | { readonly kind: 'spread' }
  | { readonly kind: 'items'; readonly items: number; readonly tail: boolean };

/** A call pattern: the fields it gives by position, then by name, how its rest, and `...`. */
interface GeneratedPattern {
  readonly positional: number;
  readonly named: readonly number[];
  readonly rest: RestMatch;
  readonly leavesOthers: boolean;
}

const variants = fc
  .record({ fields: fc.integer({ min: 1, max: 4 }), hasRest: fc.boolean() })
  .chain(({ fields, hasRest }) =>
    fc.integer({ min: 0, max: fields }).map((required) => ({ fields, required, hasRest })),
  );

function restMatchesOf(hasRest: boolean, allPositional: boolean): fc.Arbitrary<RestMatch> {
  if (!hasRest) {
    return fc.constant({ kind: 'left' });
  }
  const items = fc.record({
    kind: fc.constant('items' as const),
    items: fc.integer({ min: 1, max: 3 }),
    tail: fc.boolean(),
  });
  return fc.oneof(
    fc.constant({ kind: 'left' } as const),
    fc.constant({ kind: 'spread' } as const),
    ...(allPositional ? [items] : []),
  );
}

function patternsOf({
  fields,
  required,
  hasRest,
}: GeneratedVariant): fc.Arbitrary<GeneratedPattern> {
  return fc.integer({ min: 0, max: fields }).chain((positional) => {
    const others = Array.from({ length: fields - positional }, (_, index) => positional + index);
    return fc
      .record({
        positional: fc.constant(positional),
        named: fc.shuffledSubarray(others),
        rest: restMatchesOf(hasRest, positional === fields),
        leavesOthers: fc.boolean(),
      })
      .filter(
        (pattern) =>
          pattern.leavesOthers ||
          others.every((field) => field >= required || pattern.named.includes(field)),
      );
  });
}

function declaration({ fields, required, hasRest }: GeneratedVariant): string {
  const declared = Array.from({ length: fields }, (_, index) =>
    index < required ? `f${index}: Int` : `f${index}: Int = ${100 + index}`,
  );
  return `enum E { V(${[...declared, ...(hasRest ? ['...more: Array<Int>'] : [])].join(', ')}), Other }`;
}

/** The fixed fields a pattern gives, by position or by name, in field order. */
function givenFields(pattern: GeneratedPattern): readonly number[] {
  return [
    ...Array.from({ length: pattern.positional }, (_, index) => index),
    ...pattern.named,
  ].toSorted((first, second) => first - second);
}

/** The items a rest's items are matched by: `r0`…, then maybe a spread binding `tail`. */
function itemsOf(rest: Extract<RestMatch, { kind: 'items' }>): readonly string[] {
  return [
    ...Array.from({ length: rest.items }, (_, index) => `r${index}`),
    ...(rest.tail ? ['...tail'] : []),
  ];
}

/**
 * How a rest is matched, as a call pattern's arguments and as a brace pattern's items: a call
 * pattern's last `...` leaves the items past those it matches, as an array pattern's `..._` does.
 */
function restForms(
  rest: RestMatch,
  leavesOthers: boolean,
): {
  readonly call: readonly string[];
  readonly brace: readonly string[];
} {
  switch (rest.kind) {
    case 'spread':
      return { call: ['...all'], brace: ['more as all'] };
    case 'items': {
      const items = itemsOf(rest);
      const open = leavesOthers && !rest.tail ? ['..._'] : [];
      return { call: items, brace: [`more is [${[...items, ...open].join(', ')}]`] };
    }
    default:
      return { call: [], brace: [] };
  }
}

/** The names a pattern binds, in field order, then the rest's: `r0`…, `tail` or `all`. */
function boundNames(pattern: GeneratedPattern): readonly string[] {
  const rest = restForms(pattern.rest, pattern.leavesOthers).call.map((item) =>
    item.replace('...', ''),
  );
  return [...givenFields(pattern).map((field) => `p${field}`), ...rest];
}

function callPattern(pattern: GeneratedPattern): string {
  const given = [
    ...Array.from({ length: pattern.positional }, (_, index) => `p${index}`),
    ...restForms(pattern.rest, pattern.leavesOthers).call,
    ...pattern.named.map((field) => `f${field}: p${field}`),
    ...(pattern.leavesOthers ? ['...'] : []),
  ];
  return `E.V(${given.join(', ')})`;
}

function bracePattern(pattern: GeneratedPattern): string {
  const fixed = givenFields(pattern).map((field) => `f${field} as p${field}`);
  return `E.V{${[...fixed, ...restForms(pattern.rest, pattern.leavesOthers).brace].join(', ')}}`;
}

/** A value of the variant: each field's Int, and the rest's items when it has one. */
interface GeneratedValue {
  readonly values: readonly number[];
  readonly items: readonly number[];
}

function valuesOf({ fields, hasRest }: GeneratedVariant): fc.Arbitrary<readonly GeneratedValue[]> {
  const value = fc.record({
    values: fc.array(fc.integer({ min: -9, max: 9 }), { minLength: fields, maxLength: fields }),
    items: hasRest ? fc.array(fc.integer({ min: -9, max: 9 }), { maxLength: 4 }) : fc.constant([]),
  });
  return fc.array(value, { minLength: 1, maxLength: 4 });
}

function literal(variant: GeneratedVariant, { values, items }: GeneratedValue): string {
  const given = values.map((value, index) => `f${index}: ${value}`);
  const rest = variant.hasRest ? [`more: [${items.join(', ')}]`] : [];
  return `E.V{${[...given, ...rest].join(', ')}}`;
}

function shown(name: string): string {
  return ['all', 'tail'].includes(name) ? `\${${name}.length()}` : `\${${name}}`;
}

function matcher(name: string, pattern: string, bound: readonly string[]): string {
  return [
    `fn ${name}(e: E) -> String:`,
    '  match e:',
    `    case ${pattern}: \`${bound.map(shown).join(' ')}\``,
    '    case _: "no"',
  ].join('\n');
}

function outcomeOf(source: string): unknown {
  const state = startToEnd(testRuntime(), compiledText(source));
  return state.kind === 'finished' ? decodeJson(String(state.outcome)) : state;
}

describe('a call pattern', () => {
  it('matches and binds what the brace pattern naming the same fields does', () => {
    fc.assert(
      fc.property(
        variants.chain((variant) =>
          fc.record({
            variant: fc.constant(variant),
            pattern: patternsOf(variant),
            values: valuesOf(variant),
          }),
        ),
        ({ variant, pattern, values }) => {
          const bound = boundNames(pattern);
          const source = [
            declaration(variant),
            matcher('byCall', callPattern(pattern), bound),
            matcher('byBraces', bracePattern(pattern), bound),
            'async fn main() -> Future<Array<String>>:',
            `  const values: Array<E> = [${values.map((value) => literal(variant, value)).join(', ')}, E.Other]`,
            '  [values.map(byCall).join(";"), values.map(byBraces).join(";")]',
          ].join('\n');
          const outcome = outcomeOf(source);
          expect(Array.isArray(outcome)).toBe(true);
          const [byCall = '', byBraces] = outcome as readonly string[];
          expect(byCall).toBe(byBraces);
          // Only items past the fixed fields test a length; every other pattern matches each value.
          const matchedEach = !byCall.split(';').slice(0, -1).includes('no');
          expect(pattern.rest.kind === 'items' || matchedEach).toBe(true);
        },
      ),
      { numRuns: 40 },
    );
  });
});

const declarations = [
  'enum Verdict { Approved, Rejected(by: String, reason: String) }',
  'enum Node { Text(value: String), Group(title: String, open: Bool = false, ...children: Array<Node>) }',
  'enum Wide { Many(a: Int, b: Int, ...more: Array<Int>), Few }',
  'enum Opt<T> { Some(value: T), Nothing }',
  'struct Point { x: Int, y: Int }',
];

/** A function matching `subject` by `cases`, giving a `result`, beside the enums above. */
function matching(subject: string, result: string, cases: readonly string[]): string {
  return [
    ...declarations,
    `fn f(v: ${subject}) -> ${result}:`,
    '  match v:',
    ...cases.map((each) => `    ${each}`),
  ].join('\n');
}

describe('a call pattern reports each mistake once', () => {
  it.each([
    [
      'a field a spread passes over',
      matching('Wide', 'Int', ['case Many(1, ...more): 1', 'case _: 0']),
      [5428],
      ['Many(1, ...more)'],
    ],
    [
      'an argument by position after one by name',
      matching('Verdict', 'String', ['case Rejected(by: "a", r): r', 'case _: ""']),
      [2050],
      ['r'],
    ],
    [
      'a second spread',
      matching('Node', 'Array<Node>', ['case Node.Group(t, ...one, ...two): two', 'case _: []']),
      [2071],
      ['...two'],
    ],
    [
      "an array pattern's second rest",
      matching('Array<Int>', 'Array<Int>', ['case [t, ...one, ...two]: two', 'case _: []']),
      [2071],
      ['...two'],
    ],
    [
      'a variant of an enum the matched union lacks, with its type arguments',
      matching('Int | String', 'Int', ['case Opt.Some<Int>(n): n', 'case _: 0']),
      [5422],
      ['Opt.Some<Int>(n)'],
    ],
    [
      'a struct named against an enum',
      matching('Verdict', 'Int', [
        'case Point(x, y): 1',
        'case Approved: 2',
        'case Rejected(by, r): 3',
      ]),
      [5426],
      ['Point'],
    ],
  ])('%s', (_, text, codes, spanTexts) => {
    expect(reported(text)).toEqual({ codes, spanTexts });
  });

  it('takes no argument the parser recovered for a field', () => {
    const text = matching('Verdict', 'String', ['case Rejected(by, reason, +): by', 'case _: ""']);
    expect(reported(text).codes.every((code) => code < 3000)).toBe(true);
  });
});
