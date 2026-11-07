/**
 * Variant calls (§3.11) against the brace literal they mean: a call binds its arguments to the
 * fields as a call binds parameters (§3.3), so over generated variants and calls, positional and
 * named in any order, defaults left out and a rest collecting the extra positional arguments, the
 * value a call builds is the one the literal naming every field it gives builds.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeJson } from '../../../../../definition/formats/codec.ts';
import { startToEnd, testRuntime } from '../../../../../runtime/runtime.test-kit.ts';
import { compiledText } from '../../../../compile.test-kit.ts';

/** A variant of Int fields, the first `required` without a default, maybe ending in a rest. */
interface GeneratedVariant {
  readonly fields: number;
  readonly required: number;
  readonly hasRest: boolean;
}

/** A call of it: how many fields it gives by position, then which by name, in what order. */
interface GeneratedCall {
  readonly positional: number;
  readonly named: readonly number[];
  readonly extra: readonly number[];
}

const variants = fc
  .record({ fields: fc.integer({ min: 1, max: 4 }), hasRest: fc.boolean() })
  .chain(({ fields, hasRest }) =>
    fc.integer({ min: 0, max: fields }).map((required) => ({ fields, required, hasRest })),
  );

function callsOf({ fields, required, hasRest }: GeneratedVariant): fc.Arbitrary<GeneratedCall> {
  return fc.integer({ min: 0, max: fields }).chain((positional) => {
    const rest = Array.from({ length: fields - positional }, (_, index) => positional + index);
    const mustName = rest.filter((field) => field < required);
    const mayName = rest.filter((field) => field >= required);
    const extra =
      hasRest && positional === fields ? fc.array(fc.integer(), { maxLength: 3 }) : fc.constant([]);
    return fc.record({
      positional: fc.constant(positional),
      named: fc.subarray(mayName).chain((chosen) =>
        fc.shuffledSubarray([...mustName, ...chosen], {
          minLength: mustName.length + chosen.length,
        }),
      ),
      extra,
    });
  });
}

function declaration({ fields, required, hasRest }: GeneratedVariant): string {
  const declared = Array.from({ length: fields }, (_, index) =>
    index < required ? `f${index}: Int` : `f${index}: Int = ${100 + index}`,
  );
  return `enum E { V(${[...declared, ...(hasRest ? ['...more: Array<Int>'] : [])].join(', ')}), Other }`;
}

function call({ positional, named, extra }: GeneratedCall): string {
  const given = [
    ...Array.from({ length: positional }, (_, index) => String(index + 1)),
    ...extra.map(String),
    ...named.map((field) => `f${field}: ${field + 1}`),
  ];
  return `E.V(${given.join(', ')})`;
}

function literal(variant: GeneratedVariant, { positional, named, extra }: GeneratedCall): string {
  const given = [...Array.from({ length: positional }, (_, index) => index), ...named]
    .toSorted((first, second) => first - second)
    .map((field) => `f${field}: ${field + 1}`);
  const rest = variant.hasRest ? [`more: [${extra.join(', ')}]`] : [];
  return `E.V{${[...given, ...rest].join(', ')}}`;
}

function outcomeOf(source: string): unknown {
  const state = startToEnd(testRuntime(), compiledText(source));
  return state.kind === 'finished' ? decodeJson(String(state.outcome)) : state;
}

describe('a variant call', () => {
  it('builds what the brace literal naming the fields it gives builds', () => {
    fc.assert(
      fc.property(
        variants.chain((variant) => callsOf(variant).map((made) => ({ variant, made }))),
        ({ variant, made }) => {
          const source = [
            declaration(variant),
            'async fn main() -> Future<Bool>:',
            `  const called: E = ${call(made)}`,
            `  called == ${literal(variant, made)}`,
          ].join('\n');
          expect(outcomeOf(source)).toBe(true);
        },
      ),
      { numRuns: 40 },
    );
  });
});
