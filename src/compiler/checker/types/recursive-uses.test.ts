/**
 * A recursive alias use and what it unfolds to (§3.17, proposal 5 §2): one type by identity
 * whatever the body's kind, taken apart where a value is used (`!`, `??`, `?.`), put into a union
 * through a member its body holds, and built from literals of any depth with any items, the way
 * its body is, no fold or unfold written. Each case runs where running shows what checking can't:
 * a value taken out of the wrong variant checks but gives a wrong result.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing } from '../../../diagnostics/diagnostic.test-kit.ts';
import { mainGives } from '../../../stdlib/prelude/prelude.test-kit.ts';
import { lines } from '../../parser/parse.test-kit.ts';
import { reported } from '../check.test-kit.ts';

const chain = 'type Chain = (Int, Chain?)';
const tree = 'type Tree = Int | Array<Tree>';

describe('a value of a recursive use whose body is a tuple, a function or a nominal type', () => {
  it('takes a tuple out of an optional with ! and ??, as its own variant', () => {
    const declarations = lines(
      chain,
      'fn force(c: Chain?) -> Int:',
      '  const got = c!',
      '  return got.0',
      'fn orElse(c: Chain?) -> Int:',
      '  const got = c ?? (0, none)',
      '  return got.0',
    );
    expect(
      mainGives('Int', 'return force((10, none)) + orElse(none) + orElse((5, none))', declarations),
    ).toBe(15);
  });

  it('keeps the use in a container built of its values', () => {
    const source = lines(
      chain,
      'fn take(xs: Array<Chain>) -> Int: xs.length()',
      'fn wrap(c: Chain) -> Int:',
      '  const xs = [c]',
      '  return take(xs)',
    );
    expect(reported(source)).toEqual(reportedNothing);
  });

  it('reads through ?. into a tuple and a function', () => {
    const source = lines(
      chain,
      'type Machine = fn(Int) -> Machine',
      'fn first(c: Chain?) -> Int?: c?.0',
      'fn step(m: Machine?) -> Machine?: m?.(1)',
    );
    expect(reported(source)).toEqual(reportedNothing);
    expect(
      mainGives(
        'Int?',
        'return first((7, none))',
        lines(chain, 'fn first(c: Chain?) -> Int?: c?.0'),
      ),
    ).toBe(7);
  });

  it('keeps a nominal body the use in an array of its values', () => {
    const source = lines(
      'type Nested = Array<Nested>',
      'fn take(xs: Array<Nested>) -> Int: xs.length()',
      'fn wrap(n: Nested) -> Int: take([n, n])',
    );
    expect(reported(source)).toEqual(reportedNothing);
  });
});

describe('a member a recursive member of a union holds', () => {
  it('goes into the union through that member', () => {
    const declarations = lines(
      tree,
      'fn wrap<U>(x: U) -> U | Tree | String: x',
      'fn isTree() -> Bool: wrap(42) is Tree',
      'fn widened() -> Int:',
      '  const x: Tree | Int | String = 42',
      '  match x:',
      '    case Int as n: return n',
      '    case _: return 0',
    );
    expect(reported(declarations)).toEqual(reportedNothing);
    expect(mainGives('Bool', 'return isTree()', declarations)).toBe(true);
    expect(mainGives('Int', 'return widened()', declarations)).toBe(42);
  });
});

describe('a literal built as a recursive use, at any depth, with any items', () => {
  it.each([
    [
      'calls in an array against Json',
      'fn t() -> Bool: true\nfn f() -> Json: [t(), t()]',
      [true, true],
    ],
    ['arithmetic in an array against Json', 'fn f() -> Json: [1 + 1]', [2]],
    ['arithmetic in a map against Json', 'fn f() -> Json: ["a": 1 + 1]', { a: 2 }],
  ])('%s', (_name, declarations, expected) => {
    const source = lines("import Json from 'json'", declarations);
    expect(reported(source)).toEqual(reportedNothing);
    expect(mainGives('Json', 'return f()', source)).toEqual(expected);
  });

  it.each([
    ['arithmetic beside a String', '[1 + 1, "a"]', '[2, "a"]'],
    ['arithmetic beside an array', '[1 + 1, [2]]', '[2, [2]]'],
    ['an array beside arithmetic', '[[2], 1 + 1]', '[[2], 2]'],
    ['a call beside a map', '[t(), ["k": 1]]', '[3, {"k": 1}]'],
    ['a map of arithmetic beside a String', '["a": 1 + 1, "b": "x"]', '{"a": 2, "b": "x"}'],
    ['mixed items two levels down', '[["a": [t(), "b"]], 1 + 1]', '[{"a": [3, "b"]}, 2]'],
  ])('builds %s into Json, each item against Json', (_name, literal, text) => {
    const declarations = lines(
      "import * as json from 'json'",
      "import Json from 'json'",
      'fn t() -> Int: 3',
      `fn built() -> Json: ${literal}`,
      'fn parsed() -> Json:',
      `  match json.parse<Json>(${JSON.stringify(text)}):`,
      '    case Ok{value}: value',
      '    case Err{error}: panic(error.message)',
    );
    expect(reported(declarations)).toEqual(reportedNothing);
    expect(mainGives('Bool', 'return built() == parsed()', declarations)).toBe(true);
  });

  it('builds arithmetic beside a nested array into a recursive alias of its own', () => {
    const declarations = lines(tree, 'fn f() -> Tree: [1 + 1, [2]]');
    expect(reported(declarations)).toEqual(reportedNothing);
  });

  it.each([
    ['an array of arithmetic', 'type U = Int | Array<U>\nfn f() -> U: [1 + 1]'],
    ['an array argument', `${tree}\nfn g(t: Tree) -> Int: 1\nfn f() -> Int: g([1])`],
    [
      'a generic alias argument',
      'type T2<T> = T | Array<T2<T>>\nfn g(t: T2<Int>) -> Int: 1\nfn f() -> Int: g([1])',
    ],
    [
      'a Json array argument',
      "import Json from 'json'\nfn b(j: Json) -> Int: 1\nfn f() -> Int: b([1, 2])",
    ],
    [
      'a Json map argument',
      'import Json from \'json\'\nfn b(j: Json) -> Int: 1\nfn f() -> Int: b(["a": 1])',
    ],
    ['a tuple three deep', `${chain}\nfn f() -> Chain: (1, (2, (3, none)))`],
    ['optional arrays three deep', 'type Nested = Array<Nested?>\nfn f() -> Nested: [[[none]]]'],
    [
      'a tuple in a union in a union',
      'type U2 = (Int, Int?) | String\nfn f() -> (U2, Int) | Bool: ((1, none), 2)',
    ],
    ['mutually recursive aliases', 'type X = Array<Y>\ntype Y = Int | X\nfn f() -> Y: [1, [2]]'],
    [
      'mutually recursive aliases, the other order',
      'type Y = Int | X\ntype X = Array<Y>\nfn f() -> Y: [1, [2]]',
    ],
  ])('%s', (_name, source) => {
    expect(reported(source)).toEqual(reportedNothing);
  });

  it('runs a deep tuple literal into its alias', () => {
    const declarations = lines(
      chain,
      'fn sum(c: Chain?) -> Int:',
      '  match c:',
      '    case None: return 0',
      '    case Chain as link: return link.0 + sum(link.1)',
    );
    expect(mainGives('Int', 'return sum((1, (2, (3, none))))', declarations)).toBe(6);
  });
});

describe('a recursive shape alias and a generic recursive alias named where a type is', () => {
  const list = 'type List = { head: Int, tail: List? }';

  it('builds a recursive shape alias from braces and from an indented value', () => {
    const declarations = lines(
      list,
      'fn braces() -> List: List{head: 1, tail: none}',
      'fn indented() -> List:',
      '  return List:',
      '    head: 2',
      '    tail: none',
    );
    expect(reported(declarations)).toEqual(reportedNothing);
    expect(mainGives('Int', 'return braces().head + indented().head', declarations)).toBe(3);
  });

  it('matches a generic recursive alias by name, with its arguments or without', () => {
    const declarations = lines(
      'type Tree<T> = T | Array<Tree<T>>',
      'fn named(x: Tree<Int> | String) -> Bool: x is Tree<Int>',
      'fn bare(x: Tree<Int> | String) -> Bool: x is Tree',
    );
    expect(reported(declarations)).toEqual(reportedNothing);
    expect(
      mainGives('Bool', 'return named(1) and bare([2]) and not named("s")', declarations),
    ).toBe(true);
  });
});

describe('an indented value as a literal of its form', () => {
  it('widens its items as the bracket literal it reads as does', () => {
    const body = (items: string) =>
      lines(
        'struct Form { a: Int, b: Int }',
        'fn count(f: Form) -> Int:',
        '  let n = 0',
        '  for k, _ in ...f:',
        `    const pair =${items}`,
        '    n += pair.length()',
        '  return n',
      );
    const brackets = body(' [struct{key: k}, struct{key: "other"}]');
    const indented = body('\n      - key: k\n      - key: "other"');
    expect(reported(indented)).toEqual(reported(brackets));
    expect(reported(indented)).toEqual(reportedNothing);
  });
});
