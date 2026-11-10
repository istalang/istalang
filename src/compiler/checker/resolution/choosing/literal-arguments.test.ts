/**
 * A literal argument of items with types of their own (§3.7): it has its own type when choosing,
 * and, where that doesn't fit a parameter whose type is known while its items do, it is built as
 * the parameter's type, as a declaration's expected type builds it: `f(struct{c: 3})` for
 * `f(x: { c: Int? })`, `g((3,))` for `g(x: (Int?,))`, `h([3])` for `h(x: Array<Int?>)`, nested
 * too. A function taking it as its own type beats one building it, and building never infers.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeJson } from '../../../../definition/formats/codec.ts';
import { startToEnd, testRuntime } from '../../../../runtime/runtime.test-kit.ts';
import { compiledText } from '../../../compile.test-kit.ts';
import { reported } from '../../check.test-kit.ts';

/** What `async fn main() -> Future<String>: body` gives after `declarations`. */
async function outcome(declarations: readonly string[], body: string): Promise<unknown> {
  const source = [...declarations, 'async fn main() -> String:', `  ${body}`].join('\n');
  const state = await startToEnd(testRuntime(), compiledText(source));
  return state.kind === 'finished' ? decodeJson(String(state.outcome)) : state;
}

const takers = [
  'fn f(x: { c: Int? }) -> String: `f:${x.c ?? 0}`',
  'fn g(x: (Int?,)) -> String: `g:${x.0 ?? 0}`',
  'fn h(x: Array<Int?>) -> String: `h:${x.length()}`',
  'fn m(x: Map<String, Int?>) -> String: `m:${x.size()}`',
  'fn n(x: { inner: (Int?, Array<String?>) }) -> String: `n:${x.inner.1.length()}`',
];

describe('a literal argument of items with types of their own', () => {
  it('is built as the parameter type its items fit', async () => {
    expect(
      await outcome(
        takers,
        '`${f(struct{c: 3})} ${g((3,))} ${h([3, 4])} ${m(["a": 1])} ${n(struct{inner: (1, ["x"])})}`',
      ),
    ).toBe('f:3 g:3 h:2 m:1 n:1');
  });

  it('still refuses a parameter its items don`t fit', () => {
    expect(
      reported([...takers, 'fn main() -> String: f(struct{c: "x"})'].join('\n')).codes,
    ).toEqual([5001]);
  });

  it('goes to the overload its items fit', async () => {
    expect(
      await outcome(
        [
          'fn pick(x: { c: Int? }) -> String: "optional"',
          'fn pick(x: { c: String }) -> String: "string"',
        ],
        '`${pick(struct{c: 3})} ${pick(struct{c: "a"})}`',
      ),
    ).toBe('optional string');
  });

  it('is built from items whatever expression gives them, each checked once', async () => {
    expect(
      await outcome(
        [...takers, 'fn plus(n: Int) -> Int: n + 1'],
        'const x = 2\n  `${f(struct{c: x + 1})} ${g((plus(x),))} ${h([x * 2, x])}`',
      ),
    ).toBe('f:3 g:3 h:2');
  });

  it('is built only as a struct type it gives every field of, but those with a default', async () => {
    const declarations = [
      'fn pick(x: { a: Int? }) -> String: "one"',
      'fn pick(x: { a: Int?, b: String }) -> String: "two"',
      'struct Defaulted { a: Int?, b: String = "b" }',
      'fn fill(x: Defaulted) -> String: x.b',
    ];
    const body = [
      'const u: { a: Int? } | { a: Int?, b: String } = struct{a: none}',
      '`${pick(struct{a: 3})} ${pick(struct{a: none})} ${pick(struct{a: 3, b: "x"})} ${fill(struct{a: 1})}`',
    ].join('\n  ');
    expect(await outcome(declarations, body)).toBe('one one two b');
  });

  it('prefers the overload taking it as its own type', async () => {
    expect(
      await outcome(
        [
          'fn pick(x: Array<Int>) -> String: "own"',
          'fn pick(x: Array<Int?>) -> String: "built"',
          'fn pair(x: (Int, String)) -> String: "own"',
          'fn pair(x: (Int?, String)) -> String: "built"',
        ],
        '`${pick([1])} ${pick([1, none])} ${pair((1, "a"))} ${pair((none, "a"))}`',
      ),
    ).toBe('own built own built');
  });

  it('infers type arguments from its own type, never by building', async () => {
    expect(
      await outcome(
        [
          'fn first<T>(x: Array<T>) -> String: `${x.length()}`',
          'fn same<T>(a: T, b: { c: T? }) -> String: "same"',
        ],
        '`${first([struct{c: 3}])} ${same(1, struct{c: 2})}`',
      ),
    ).toBe('1 same');
  });

  it('agrees with the literal written where the parameter type is expected', async () => {
    const items = fc.array(fc.integer({ min: -9, max: 9 }), { minLength: 1, maxLength: 4 });
    await fc.assert(
      fc.asyncProperty(items, async (values) => {
        const written = values.join(', ');
        const declarations = [
          'fn total(x: Array<Int?>) -> Int:',
          '  let sum = 0',
          '  for v in x:',
          '    sum += v ?? 0',
          '  sum',
        ];
        expect(await outcome(declarations, `\`\${total([${written}])}\``)).toEqual(
          await outcome(declarations, `const xs: Array<Int?> = [${written}]\n  \`\${total(xs)}\``),
        );
      }),
      { numRuns: 15 },
    );
  });
});
