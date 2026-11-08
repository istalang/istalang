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
  'struct Pair<T> { a: T, b: T }',
  'struct Mix<T> { item: Item<T>, other: T }',
  'struct Holder<T, U> { f: fn(T) -> U, arg: T }',
  'fn items<T>(xs: Array<Item<T>>) -> Options<T>: Options.Items(xs)',
  'fn boxed<T>(x: T) -> Box<T>: Box{value: x}',
  'fn twice<T>(f: fn(T) -> T) -> fn(T) -> T: fn x: f(f(x))',
  'fn id<T>(x: T) -> T: x',
  'fn pair<T>(a: T, b: T) -> Array<T>: [a, b]',
  'enum Outcome<T, E> { Good(value: T), Bad(error: E) }',
  'fn good<U>(g: fn(Int) -> Outcome<U, String>) -> Outcome<U, String>: g(1)',
  'fn optsOr<U>(g: fn(Int) -> Options<U>, fallback: U) -> Options<U>: g(1)',
  'fn goodPair<U>(p: (Int, fn(Int) -> Outcome<U, String>)) -> Outcome<U, String>: (p.1)(p.0)',
  'fn takeOutcome<U>(o: Outcome<U, String>) -> Outcome<U, String>: o',
  'struct WrapOutcome<U> { outcome: Outcome<U, String> }',
];

/** What checking `functions` after the declarations above reports. */
function reportedAfter(...functions: readonly string[]) {
  return reportedImporting([], ...functions);
}

/** What checking `functions` after `imports` and the declarations above reports. */
function reportedImporting(imports: readonly string[], ...functions: readonly string[]) {
  return reported([...imports, ...declarations, ...functions, 'async fn main(): 0'].join('\n'));
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

  it('infers an open type parameter of its expected enum from its arguments', () => {
    expect(
      reportedAfter(
        'fn direct() -> Outcome<Int, String>: takeOutcome(Good(5))',
        'fn unannotated():\n  _ = takeOutcome(Good(5))',
        'fn inStruct():\n  _ = WrapOutcome{outcome: Good(5)}',
      ),
    ).toEqual(checksCleanly);
  });
});

describe('a generic struct literal in joint inference', () => {
  it('infers its type parameter across all of its fields and the enclosing call, regardless of field order', () => {
    expect(
      reportedAfter(
        'fn pairLiterals() -> Pair<"s" | "m">: id(Pair{a: "s", b: "m"})',
        'fn mixItemFirst() -> Mix<"s" | "m">: id(Mix{item: Item{value: "s"}, other: "m"})',
        'fn mixOtherFirst() -> Mix<"s" | "m">: id(Mix{other: "m", item: Item{value: "s"}})',
        'fn optionalFirst():\n  _ = Pair{a: 1, b: none}',
        'fn optionalSecond():\n  _ = Pair{a: none, b: 1}',
        'fn fromVariable(x: Int?):\n  _ = Pair{a: 1, b: x}',
      ),
    ).toEqual(checksCleanly);
  });

  it('postpones an anonymous struct literal or lambda field until its parameter inputs settle', () => {
    expect(
      reportedAfter(
        'fn anonInJoined() -> Mix<"s" | "m">: id(Mix{item: struct{value: "s"}, other: "m"})',
        'fn anonBeforeSibling():\n  _ = Mix{item: struct{value: "s"}, other: "m"}',
        'fn lambdaInStruct():\n  _ = Holder{arg: 3, f: fn x: x + 1}',
      ),
    ).toEqual(checksCleanly);
  });
});

describe('parenthesized and shared-struct literals in joint inference', () => {
  it('joins through parentheses and `new` struct literals', () => {
    expect(
      reportedAfter(
        'fn parenList() -> Options<"s" | "m">: items(([Item{value: "s"}]))',
        'fn parenItem() -> Options<"s" | "m">: items([(Item{value: "s"})])',
        'fn parenCall() -> Box<Result<Int?, String>>: boxed((Result.Ok(5)))',
        'fn sharedLit() -> Shared<"s" | "m">: id(new Shared{value: "s"})',
        'fn sharedBare() -> Shared<Size>: id(new Shared{value: Small})',
      ),
    ).toEqual(checksCleanly);
  });
});

describe("a postponed lambda's guide and joining", () => {
  it('guides and settles a lambda whose result is partly open across blocks, branches, returns and composites', () => {
    expect(
      reportedAfter(
        'fn parenBody():\n  _ = good(fn x: (Good(x + 1)))',
        'fn blockBody():\n  _ = good(fn x: { const y = x + 1; Good(y) })',
        'fn branchBody():\n  _ = good(fn x: if x > 0: Good(x) else: Bad("no"))',
        'fn returnBody():\n  _ = good(fn x: { const y = x + 1; return Good(y) })',
        'fn fieldlessWithFallback():\n  _ = optsOr(fn x: Empty, 42)',
        'fn qualifiedFieldlessWithFallback():\n  _ = optsOr(fn x: Options.Empty, 42)',
        'fn inTuple():\n  _ = goodPair((1, fn x: Good(x + 1)))',
        'fn guidedReturn(vs: Array<Int>) -> Array<Result<Int, String>>: vs.map(fn x: { const y = x; return Ok(y) })',
        'fn guidedQualifiedReturn(vs: Array<Int>) -> Array<Result<Int, String>>: vs.map(fn x: { const y = x; return Result.Ok(y) })',
      ),
    ).toEqual(checksCleanly);
  });
});

describe('what the expected type bounds', () => {
  it('advises what an argument bounds after it, wherever the argument stands', () => {
    expect(
      reportedImporting(
        ["import Json from 'json'"],
        'fn mapped(vs: Array<Int>) -> Array<Json>: vs.map(fn x: [x, "a"])',
        'fn built(x: Int) -> Item<Json>: Item{value: [x, "a"]}',
      ),
    ).toEqual(checksCleanly);
  });

  it('is set aside where a lambda its call infers disagrees with it, reported at the call', () => {
    expect(
      reportedAfter(
        'fn f(xs: Array<Int>) -> Int:',
        '  const ys: Array<String> = xs.map(fn x: {',
        '    if x < 0: return 0',
        '    x + 1',
        '  })',
        '  ys.length()',
        'fn g(xs: Array<Int>) -> Int:',
        '  const ys: Array<String> = xs.map(fn x: {',
        '    if x < 0: return id(0)',
        '    x + 1',
        '  })',
        '  ys.length()',
      ).codes,
    ).toEqual([5001, 5001]);
  });
});

describe('a lambda its scope judges once it settles', () => {
  it('is checked inside the functions it is written in, each capturing what it names', () => {
    const lambda = 'fn(x: Int) -> Outcome<Int, String>: good(fn y: Good(y + x + base))';
    expect(outcome(`{ const base = 100; String([1, 2].map(${lambda}).length()) }`)).toBe('2');
  });
});

describe('literals whose items need checking before choosing', () => {
  it('checks computed items ahead so overloads and generic parameters see their types', () => {
    expect(
      reportedAfter(
        'fn pickShape(x: { c: Int? }) -> String: "int"',
        'fn pickShape(x: { c: String }) -> String: "str"',
        'fn pickArr(x: Array<Int?>) -> String: "int"',
        'fn pickArr(x: Array<String?>) -> String: "str"',
        'fn useComputed():\n' +
          '  _ = pickShape(struct{c: 1 + 2})\n' +
          '  _ = pickArr([1 + 2, none])\n' +
          '  _ = id([1 + 2, none])\n' +
          '  _ = id([Size.Large, Small])\n' +
          '  _ = id((struct{a: 1 + 2}, 1))',
      ),
    ).toEqual(checksCleanly);
  });

  it('keeps scalar literals fresh across branches, blocks, tuples and struct{…} in a scope', () => {
    expect(
      reportedAfter(
        'fn apply<U>(f: fn() -> U) -> U: f()',
        'fn branchLit(c: Bool) -> Box<"s" | "m">: boxed(if c: "s" else: "m")',
        'fn idBranchLit(c: Bool) -> "s" | "m": id(if c: "s" else: "m")',
        'fn blockLit() -> Box<"s" | "m">: boxed({ const x = 1; "s" })',
        'fn tupleLit() -> Box<("s" | "m", Int)>: boxed(("s", 1))',
        'fn parenTupleLit() -> Box<("s" | "m", Int)>: boxed((("s"), 1))',
        'fn lambdaReturnLit(c: Bool) -> Box<"s" | "m">:\n' +
          '  boxed(apply(fn(): {\n' +
          '    if c: return "s"\n' +
          '    "m"\n' +
          '  }))',
        'fn lambdaTailLit() -> Box<"s" | "m">: boxed(apply(fn(): "m"))',
        'fn lambdaParenTailLit() -> Box<"s" | "m">: boxed(apply(fn(): ("m")))',
        'fn lambdaBlockTailLit() -> Box<"s" | "m">: boxed(apply(fn(): { const x = 1; "m" }))',
        'fn shapeLit() -> Box<{ a: "s" | "m" }>: boxed(struct{a: "s"})',
        'fn builtStructLit() -> Box<Item<"s" | "m">>: boxed(struct{value: "s"})',
      ),
    ).toEqual(checksCleanly);
  });

  it('opens a scope for top-level branches and collection literals so agreeing parts and placeholders settle together (B38)', () => {
    expect(
      reportedAfter(
        'fn topBareArray():\n  _ = [Small, Size.Large]',
        'fn topBareIf(c: Bool):\n  _ = if c: Small else: Size.Large',
        'fn b38NestedIfLiterals(c: Bool, d: Bool, k1: "a", k2: "b") -> String:\n  const x = if c: k1 else: (if d: k2 else: k2)\n  x',
        'fn b38SpreadArrayLiterals(k1: "a", k2: "b") -> Array<String>:\n  const xs = [k1, ...[k2]]\n  xs',
        'fn b38NestedIfOptional(c: Bool, d: Bool) -> Int?:\n  const x = if c: 1 else: (if d: 2 else: none)\n  x',
        'fn b38SpreadArrayOptional() -> Array<Int?>:\n  const xs = [1, ...[2, none]]\n  xs',
      ),
    ).toEqual(checksCleanly);
  });
});
