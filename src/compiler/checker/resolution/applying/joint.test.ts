/**
 * One system per outermost expression (design.md §4): a generic call or literal passed straight to
 * a call joins its system, so what the outermost call is expected to give, and what its other
 * arguments give, reach the type arguments of what is nested in it.
 */

import { describe, expect, it } from 'vitest';
import { decodeJson } from '../../../../definition/formats/codec.ts';
import { startToEnd, testRuntime } from '../../../../runtime/runtime.test-kit.ts';
import { compiledText } from '../../../compile.test-kit.ts';
import { reported } from '../../check.test-kit.ts';

const declarations = [
  'struct Item<T> { value: T }',
  'enum Options<T> { Items(items: Array<Item<T>>), One(item: Item<T>), Empty }',
  'enum Size { Small, Large }',
  'enum Decision { Expired, Kept }',
  'struct Box<T> { value: T }',
  'fn items<T>(xs: Array<Item<T>>) -> Options<T>: Options.Items(xs)',
  'fn boxed<T>(x: T) -> Box<T>: Box{value: x}',
  'fn twice<T>(f: fn(T) -> T) -> fn(T) -> T: fn x: f(f(x))',
  'fn id<T>(x: T) -> T: x',
  'fn pair<T>(a: T, b: T) -> Array<T>: [a, b]',
  'enum Outcome<T, E> { Good(value: T), Bad(error: E) }',
  'fn good<U>(g: fn(Int) -> Outcome<U, String>) -> Outcome<U, String>: g(1)',
];

/** What checking `functions` after the declarations above reports. */
function reportedAfter(...functions: readonly string[]) {
  return reported([...declarations, ...functions, 'async fn main(): 0'].join('\n'));
}

/** What `async fn main() -> Future<String>: body` gives after the declarations above. */
function outcome(body: string): unknown {
  const source = [...declarations, 'async fn main() -> Future<String>:', `  ${body}`].join('\n');
  const state = startToEnd(testRuntime(), compiledText(source));
  return state.kind === 'finished' ? decodeJson(String(state.outcome)) : state;
}

const checksCleanly = { codes: [], spanTexts: [] };

describe('a generic call or literal passed to a call', () => {
  it("takes its type arguments from the outermost call's expected type", () => {
    expect(
      reportedAfter(
        'fn joint() -> Options<"s" | "m">: items([Item{value: "s"}])',
        'fn nested() -> Box<"s" | "m">: boxed(id("s"))',
        'fn variant() -> Box<Result<Int?, String>>: boxed(Ok(5))',
      ),
    ).toEqual(checksCleanly);
  });

  it('decides an argument with no type of its own inside it, as a bare variant', () => {
    expect(
      reportedAfter(
        'fn bare() -> Options<Size>: items([Item{value: Small}])',
        'fn fieldless() -> Box<Options<Int>>: boxed(Options.Empty)',
      ),
    ).toEqual(checksCleanly);
  });

  it("checks a lambda inside it once the outermost call's expected type gives its parameter", () => {
    expect(reportedAfter('fn lambda() -> Box<fn(Int) -> Int>: boxed(twice(fn x: x + 1))')).toEqual(
      checksCleanly,
    );
    expect(
      outcome('const b: Box<fn(Int) -> Int> = boxed(twice(fn x: x + 1))\n  `${(b.value)(1)}`'),
    ).toBe('3');
  });

  it("lets a lambda's value join it where what it expects of the lambda's result is still open", () => {
    expect(reportedAfter('fn tail() -> Outcome<Int, String>: good(fn x: Good(x + 1))')).toEqual(
      checksCleanly,
    );
    expect(
      outcome(
        'match good(fn x: Good(x + 1)):\n    case Good(value): `good ${value}`\n    case Bad(error): error',
      ),
    ).toBe('good 2');
  });

  it("joins what the outermost call's other arguments give", () => {
    expect(outcome('const xs = pair(id(1), id(none))\n  `${xs.length()} ${xs[1] ?? 0}`')).toBe(
      '2 0',
    );
  });

  it('builds a value at the type its type arguments settle to', () => {
    expect(
      outcome(
        'const o: Options<"s" | "m"> = items([Item{value: "s"}, Item{value: "m"}])\n' +
          '  match o:\n' +
          '    case Items(xs): `${xs.length()} ${xs[0].value}${xs[1].value}`\n' +
          '    case _: ""',
      ),
    ).toBe('2 sm');
  });
});

describe('a variant call', () => {
  it('is a generic call like any other, its expected type advising its type arguments', () => {
    expect(
      reportedAfter(
        'fn optional() -> Result<Int?, String>: Ok(5)',
        'fn bare<E>() -> Result<Decision, E>: Ok(Expired)',
      ),
    ).toEqual(checksCleanly);
  });
});
