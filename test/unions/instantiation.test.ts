/**
 * Generic code over unions behaves as the code each instantiation stands for (§2 "Collapse", §3.5):
 * every function of a table using union constructs (`??`, `?.`, a value put into a union, `match`
 * with literal, union and or-patterns, `?`) gives, instantiated with a type argument, what the
 * same function written for that type gives. Type arguments are drawn from a few types and the
 * optionals and unions of them, so instantiations collapse (`T?` with `T = None` or `T = Int?`)
 * and merge (literals into `String`), which programs written for one type never do.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runMain } from './unions.test-kit.ts';

/** A type argument as written, and values of it, as written. */
interface TypeArgument {
  readonly text: string;
  readonly values: readonly string[];
}

const atoms: readonly TypeArgument[] = [
  { text: 'None', values: ['none'] },
  { text: 'Int', values: ['3'] },
  { text: '"draft"', values: ['"draft"'] },
  { text: '"draft" | "sent"', values: ['"draft"', '"sent"'] },
  { text: 'String', values: ['"x"', '"draft"'] },
  { text: 'Int | String', values: ['1', '"a"'] },
];

const atom = fc.constantFrom(...atoms);

/** `text`, with `values` of it, none written twice. */
function typeOf(text: string, values: readonly string[]): TypeArgument {
  return { text, values: [...new Set(values)] };
}

const typeArgument: fc.Arbitrary<TypeArgument> = fc.oneof(
  atom,
  atom.map(({ text, values }) => typeOf(`(${text})?`, ['none', ...values])),
  fc
    .tuple(atom, atom)
    .map(([first, second]) =>
      typeOf(`(${first.text}) | (${second.text})`, [...first.values, ...second.values]),
    ),
);

/** A generic function, compared on `calls` given a value of `T`, and as written for one type. */
interface Compared {
  readonly lines: readonly string[];
  /** The function written for one type, where the language refuses `lines` for some. */
  readonly written?: readonly string[];
  readonly calls: (value: string) => readonly string[];
}

/**
 * Generic functions of one type parameter `T`, their names ending in `$`. A generic one's `$<T>`
 * reads `G<T>` and a call names its type argument; the one written for a type reads `M`, with
 * that type for every `T`.
 */
const functions: readonly Compared[] = [
  {
    lines: ['fn coalesce$<T>(x: T?, y: T?) -> T?: x ?? y'],
    // `??` takes no `None` itself (§4), so the one written for a type is the `match` it stands for.
    written: [
      'fn coalesce$<T>(x: T?, y: T?) -> T?:',
      '  match x:',
      '    case none: y',
      '    case value: value',
    ],
    calls: (value) => [
      `coalesce$(${value}, none)`,
      `coalesce$(none, ${value})`,
      'coalesce$(none, none)',
    ],
  },
  {
    lines: ['fn get$<T>(b: Box<T>?) -> T?: b?.v'],
    calls: (value) => [`get$(Box{v: ${value}})`, 'get$(none)'],
  },
  {
    lines: [
      'fn wrap$<T>(x: "draft" | "sent") -> T | "draft" | "sent": x',
      'fn widen$<T>(x: T) -> T | "draft" | Int: x',
    ],
    calls: (value) => ['wrap$("sent")', `widen$(${value})`],
  },
  {
    lines: [
      'fn classify$<T>(x: T | "draft" | "sent" | Int) -> String:',
      '  match x:',
      '    case "draft" | "sent" as d: "lit:" + d',
      '    case Int as n: `int:${n}`',
      '    case _: "other"',
    ],
    calls: (value) => [`classify$(${value})`, 'classify$("sent")', 'classify$(5)'],
  },
  {
    lines: [
      'fn either$<T>(x: T | Int | String) -> String:',
      '  match x:',
      '    case Int | String as v: `is:${v}`',
      '    case _: "other"',
    ],
    calls: (value) => [`either$(${value})`, 'either$(5)'],
  },
  {
    lines: ['fn step$<T>(r: Result<Int, "a" | "b">) -> Result<Int, T | "a" | "b">: Ok(r?)'],
    calls: () => ['step$(Err("a"))', 'step$(Ok(1))'],
  },
];

/** The functions, generic, and again as written for `type`. */
function declarations(type: string): readonly string[] {
  const generic = functions.flatMap(({ lines }) =>
    lines.map((line) => line.replaceAll('$<T>', 'G<T>')),
  );
  const written = functions.flatMap(({ lines, written: own = lines }) =>
    own.map((line) => line.replaceAll('$<T>', 'M').replaceAll(/\bT\b/gu, `(${type})`)),
  );
  return ['struct Box<V> { v: V }', ...generic, ...written];
}

/**
 * Each call on `value`, of the generic function instantiated with `type` and of the one written for
 * it.
 */
function comparisons(type: string, value: string): readonly string[] {
  return functions
    .flatMap((each) => each.calls(value))
    .map(
      (call) => `\${${call.replaceAll('$(', `G<(${type})>(`)} == ${call.replaceAll('$(', 'M(')}}`,
    );
}

describe('generic code over unions, instantiated (§3.5)', () => {
  it('gives what the same code written for the type argument gives', () => {
    fc.assert(
      fc.property(typeArgument, ({ text, values }) => {
        const named = values.map((value, index) => ({ name: `a${index}`, value }));
        const body = [
          ...named.map(({ name, value }) => `const ${name}: (${text}) = ${value}`),
          `[${named.flatMap(({ name }) => comparisons(text, name).map((each) => `\`${each}\``)).join(', ')}]`,
        ];
        const outcome = runMain('Array<String>', body.join('\n  '), declarations(text));
        expect(outcome, `T = ${text}`).toEqual(
          named.flatMap(({ name }) => comparisons(text, name).map(() => 'true')),
        );
      }),
      { numRuns: 25 },
    );
  });
});
