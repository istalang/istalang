/**
 * Variant calls (§3.11): a call binds its arguments to the fields as a call binds parameters
 * (§3.3), so over generated variants and calls, positional and named in any order, defaults left
 * out and a rest collecting the extra positional arguments, the value a call builds is the one the
 * call naming every field builds, its defaults written out. A variant named as a value (§3.14), as
 * any function type its fields fit, builds what calling it does, and is a function value capturing
 * nothing: sendable, and equal to another naming it. A variant without fields called with `()` is
 * warned of, its name alone saying as much; one whose fields all default or are a rest, or given
 * type arguments only a call carries, needs its `()`.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeJson } from '../../../../../definition/formats/codec.ts';
import { startToEnd, testRuntime } from '../../../../../runtime/runtime.test-kit.ts';
import { compiledText } from '../../../../compile.test-kit.ts';
import { reported } from '../../../check.test-kit.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';

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

/**
 * The call giving every field of `variant` by name, as `made` leaves them: the values it gives, the
 * defaults it leaves out written out (`100 + i`), the rest one array.
 */
function everyFieldNamed(
  variant: GeneratedVariant,
  { positional, named, extra }: GeneratedCall,
): string {
  const given = new Set([...Array.from({ length: positional }, (_, index) => index), ...named]);
  const fields = Array.from(
    { length: variant.fields },
    (_, field) => `f${field}: ${given.has(field) ? field + 1 : 100 + field}`,
  );
  const rest = variant.hasRest ? [`more: [${extra.join(', ')}]`] : [];
  return `E.V(${[...fields, ...rest].join(', ')})`;
}

async function outcomeOf(source: string): Promise<unknown> {
  const state = await startToEnd(testRuntime(), compiledText(source));
  return state.kind === 'finished' ? decodeJson(String(state.outcome)) : state;
}

/** A function type a variant's fields fit: its first `taken` fields, and the rest as one array. */
interface GeneratedShape {
  readonly taken: number;
  readonly takesRest: boolean;
  readonly extra: readonly number[];
}

function shapesOf({ fields, required, hasRest }: GeneratedVariant): fc.Arbitrary<GeneratedShape> {
  return fc.integer({ min: required, max: fields }).chain((taken) =>
    fc.record({
      taken: fc.constant(taken),
      takesRest: hasRest && taken === fields ? fc.boolean() : fc.constant(false),
      extra: fc.array(fc.integer(), { maxLength: 3 }),
    }),
  );
}

function functionType({ taken, takesRest }: GeneratedShape): string {
  const parameters = [
    ...Array.from({ length: taken }, () => 'Int'),
    ...(takesRest ? ['Array<Int>'] : []),
  ];
  return `fn(${parameters.join(', ')}) -> E`;
}

function argumentsOf({ taken, takesRest, extra }: GeneratedShape, spread: boolean): string {
  const given = Array.from({ length: taken }, (_, index) => String(index + 1));
  if (!takesRest) {
    return given.join(', ');
  }
  return [...given, ...(spread ? extra.map(String) : [`[${extra.join(', ')}]`])].join(', ');
}

describe('a variant call', () => {
  it('builds what the call naming every field, defaults written out, builds', async () => {
    await fc.assert(
      fc.asyncProperty(
        variants.chain((variant) => callsOf(variant).map((made) => ({ variant, made }))),
        async ({ variant, made }) => {
          const source = [
            declaration(variant),
            "import * as runtime from 'runtime'\nlive async fn main() -> Bool: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Bool:",
            `  const called: E = ${call(made)}`,
            `  called == ${everyFieldNamed(variant, made)}`,
          ].join('\n');
          expect(await outcomeOf(source)).toBe(true);
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('a variant named as a value', () => {
  it('builds what calling the variant builds, and is a sendable value equal to another naming it', async () => {
    await fc.assert(
      fc.asyncProperty(
        variants.chain((variant) => shapesOf(variant).map((shape) => ({ variant, shape }))),
        async ({ variant, shape }) => {
          const type = functionType(shape);
          const source = [
            declaration(variant),
            "import * as runtime from 'runtime'\nlive async fn main() -> Bool: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Bool:",
            `  const made: ${type} = E.V`,
            `  const again: sendable ${type} = E.V`,
            `  made == again and made(${argumentsOf(shape, false)}) == E.V(${argumentsOf(shape, true)})`,
          ].join('\n');
          expect(await outcomeOf(source)).toBe(true);
        },
      ),
      { numRuns: 40 },
    );
  });
});

const fieldlessCalled = checkerDiagnostics.fieldlessCalled.code;

describe('a variant without fields called with `()`', () => {
  const declared = [
    'enum Verdict:',
    '  Approved',
    '  Rejected(by: String = "ops", reason = "no reason given")',
    'enum Bag { Items(...xs: Array<Int>), Nothing }',
    'enum Opt<T> { Some(value: T), Nothing }',
    '',
  ].join('\n');
  const warnedOf = (body: string) =>
    reported(`${declared}fn f() -> Array<Verdict>:\n  ${body}\nimport * as runtime from 'runtime'
live async fn main(): await runtime.run(runtime.id()) _main()
ista async fn _main(): 0\n`);

  it('is warned of, bare or qualified, its name alone saying as much (§3.11)', () => {
    expect(warnedOf('[Approved(), Verdict.Approved()]')).toEqual({
      codes: [fieldlessCalled, fieldlessCalled],
      spanTexts: ['Approved()', 'Verdict.Approved()'],
    });
  });

  it("isn't when its fields all default or are a rest, or its type arguments need the call", () => {
    const body = '_ = Bag.Items()\n  _ = Opt.Nothing<Int>()\n  [Rejected(), Verdict.Rejected()]';
    expect(warnedOf(body)).toEqual({ codes: [], spanTexts: [] });
  });
});

describe("a variant call's arguments", () => {
  const declared = [
    'struct Item<T> { value: T }',
    'enum Options<T> { Items(items: Array<Item<T>>), One(item: Item<T>), Link(next: Options<T>?), Group(title: String, ...items: Array<Item<T>>), Empty }',
    'enum Tagged<T> { Entry(items: Array<Item<"s" | "m">>, value: T) }',
    'struct View<T> { options: Options<T>? = none }',
    '',
  ].join('\n');

  it("take their fields' types once its type arguments are known, as its fields always did (§3.11)", () => {
    const functions = [
      'fn expected() -> Options<"s" | "m">: Options.Items([Item{value: "s"}])',
      'fn inOptional() -> View<"s" | "m">: View<"s" | "m">{options: Options.One(Item{value: "m"})}',
      'fn qualifiedInside() -> Options<Int>: Options.Link(Options.Empty)',
      'fn written() -> Options<"s">: Options.Items<"s">([Item{value: "s"}])',
      'fn defaulted() -> Result<Options<Int>>: Result.Ok<Options<Int>>(Options.Empty)',
      'fn spread() -> Options<"s" | "m">: Options.Group("t", ...[Item{value: "s"}])',
      'fn fixed() -> Tagged<Int>: Tagged.Entry([Item{value: "s"}], 42)',
    ].join('\n');
    expect(
      reported(`${declared}${functions}\nimport * as runtime from 'runtime'
live async fn main(): await runtime.run(runtime.id()) _main()
ista async fn _main(): 0\n`),
    ).toEqual({
      codes: [],
      spanTexts: [],
    });
  });

  it("take no type arguments from a union holding several of the enum's instances", () => {
    const text = [
      'enum Opt<T> { Val(v: T), Empty }',
      'enum Entry<K, V> { Pair(key: K, value: V) }',
      'fn f() -> Opt<Int> | Opt<String>: Opt.Val("b")',
      'fn g() -> Opt<Int> | Opt<String>: Val("b")',
      'fn k() -> Entry<"retries", Int> | Entry<"region", String>: Entry.Pair("region", "eu")',
      "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): 0",
    ].join('\n');
    expect(reported(text)).toEqual({ codes: [], spanTexts: [] });
  });

  it('are each judged against a field, beside one in error, and a call short of one is counted', () => {
    const text = [
      'enum Pair<T> { Make(a: T, xs: Array<T>) }',
      'enum Both<T> { Make(a: T, b: T) }',
      'enum Two { Make(opt: Options<Int>, reason: Int) }',
      'fn f() -> Pair<Int>: Pair.Make("bad", [1, "wrong"])',
      'fn g() -> Both<Int>: Both.Make("not an int", missing)',
      'fn h() -> Two: Two.Make(Options.Empty)',
      "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): 0",
    ].join('\n');
    expect(reported(`${declared}${text}`).codes).toEqual([5001, 5001, 5001, 4000, 5004]);
  });

  it('report an argument by position after a named one only as the parser did', () => {
    const items = 'enum Pick { Items(a: Array<String>, b: Int) }\n';
    const text = `${items}fn f() -> Pick: Pick.Items(b: 1, [123])\nimport * as runtime from 'runtime'
live async fn main(): await runtime.run(runtime.id()) _main()
ista async fn _main(): 0\n`;
    expect(reported(text).codes).toEqual([2050]);
  });
});
