/**
 * Choosing among overloads (§3.7), seen through which result a call gets: each overload of `f`
 * returns a type of its own. The choice follows the rules case by case, and never depends on the
 * order the overloads are declared in.
 */

import { describe, expect, it } from 'vitest';
import { reported } from '../check.test-kit.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';

interface ChoiceCase {
  readonly rule: string;
  readonly overloads: readonly string[];
  readonly call: string;
  /** What the call needs declared before it. */
  readonly setup?: string;
  /** The result type of the overload the call must choose; undefined when it is ambiguous. */
  readonly chosen: string | undefined;
}

const cases: readonly ChoiceCase[] = [
  {
    rule: 'a concrete function beats a generic one inferred',
    overloads: ['fn f<T>(a: T) -> bool: true', 'fn f(a: int) -> string: "c"'],
    call: 'f(5)',
    chosen: 'string',
  },
  {
    rule: 'explicit type arguments choose among generic functions only',
    overloads: ['fn f<T>(a: T) -> bool: true', 'fn f(a: int) -> string: "c"'],
    call: 'f<int>(5)',
    chosen: 'bool',
  },
  {
    rule: 'a generic function is chosen when it alone matches',
    overloads: ['fn f<T>(a: T) -> bool: true', 'fn f(a: int) -> string: "c"'],
    call: 'f("x")',
    chosen: 'bool',
  },
  {
    rule: 'only functions taking that many type arguments are considered',
    overloads: ['fn f<T>(a: T) -> bool: true', 'fn f<T, U>(a: T) -> string: "c"'],
    call: 'f<int, string>(5)',
    chosen: 'string',
  },
  {
    rule: 'two generic functions both matching are ambiguous',
    overloads: ['fn f<T>(a: T, b: int) -> bool: true', 'fn f<T>(a: int, b: T) -> string: "c"'],
    call: 'f(1, 2)',
    chosen: undefined,
  },
  {
    rule: 'a value fits an optional parameter by the implicit wrap',
    overloads: ['fn f(a: int?) -> bool: true', 'fn f(a: string) -> string: "c"'],
    call: 'f(1)',
    chosen: 'bool',
  },
  {
    rule: "the '&' at the call tells a reference parameter from a value one",
    overloads: ['fn f(a: int) -> bool: true', 'fn f(a: &int) -> string: "c"'],
    call: 'f(&n)',
    setup: 'let n = 1',
    chosen: 'string',
  },
  {
    rule: 'an argument the call decides takes only a parameter of a type it can be',
    overloads: ['fn f(a: Array<int>) -> bool: true', 'fn f(a: int) -> string: "c"'],
    call: 'f([])',
    chosen: 'bool',
  },
  {
    rule: 'a tuple holding none takes only a tuple with an optional there',
    overloads: ['fn f(a: (int, int?)) -> bool: true', 'fn f(a: (int, string)) -> string: "c"'],
    call: 'f((1, none))',
    chosen: 'bool',
  },
  {
    rule: 'a tuple holding none keeps the types of its other elements',
    overloads: ['fn f(a: (int, int?)) -> bool: true', 'fn f(a: (string, int?)) -> string: "c"'],
    call: 'f((1, none))',
    chosen: 'bool',
  },
  {
    rule: 'an array literal holding none in any position keeps the types of its other elements',
    overloads: ['fn f(a: Array<int?>) -> bool: true', 'fn f(a: Array<string?>) -> string: "c"'],
    call: 'f(["a", none])',
    chosen: 'string',
  },
  {
    rule: 'an array literal starting with none keeps the types of its later elements',
    overloads: ['fn f(a: Array<int?>) -> bool: true', 'fn f(a: Array<string?>) -> string: "c"'],
    call: 'f([none, "a"])',
    chosen: 'string',
  },
  {
    rule: 'a map literal holding none keeps the types of its keys',
    overloads: [
      'fn f(a: Map<int, int?>) -> bool: true',
      'fn f(a: Map<string, int?>) -> string: "c"',
    ],
    call: 'f(["a": none])',
    chosen: 'string',
  },
  {
    rule: 'an if expression holding none in any branch keeps the types of its other branches',
    overloads: ['fn f(a: int?) -> bool: true', 'fn f(a: string?) -> string: "c"'],
    call: 'f(if true: "a" else: none)',
    chosen: 'string',
  },
  {
    rule: 'a tuple holding none fits an optional tuple parameter',
    overloads: ['fn f(a: (int, int?)?) -> bool: true', 'fn f(a: string?) -> string: "c"'],
    call: 'f((1, none))',
    chosen: 'bool',
  },
  {
    rule: 'a tuple holding an anonymous struct literal and none guides the struct literal',
    overloads: [
      'fn f(a: ({ a: int }, int?)) -> bool: true',
      'fn f(a: (int, string)) -> string: "c"',
    ],
    call: 'f((struct{a: 1}, none))',
    chosen: 'bool',
  },
  {
    rule: 'a bare variant fits an optional enum parameter',
    overloads: [
      'enum Color { Red; Blue }\nfn f(a: Color?) -> bool: true',
      'fn f(a: int?) -> string: "c"',
    ],
    call: 'f(Red)',
    chosen: 'bool',
  },
  {
    rule: 'an overloaded function value fits an optional function parameter',
    overloads: [
      'fn g(x: int) -> int: x\nfn g(x: string) -> string: x\nfn f(a: (fn(int) -> int)?) -> bool: true',
      'fn f(a: int?) -> string: "c"',
    ],
    call: 'f(g)',
    chosen: 'bool',
  },
  {
    rule: 'a lambda in an array takes only an array of functions of its arity',
    overloads: [
      'fn f(a: Array<fn(int) -> int>) -> bool: true',
      'fn f(a: Array<fn(int, int) -> int>) -> string: "c"',
    ],
    call: 'f([fn(x): x])',
    chosen: 'bool',
  },
  {
    rule: 'an empty [] takes an array and a map alike',
    overloads: ['fn f(a: Array<int>) -> bool: true', 'fn f(a: Map<string, int>) -> string: "c"'],
    call: 'f([])',
    chosen: undefined,
  },
  {
    rule: 'a call leaving a parameter to its default chooses the function with it',
    overloads: ['fn f(a: int, b: int = 1) -> bool: true', 'fn f(a: string) -> string: "c"'],
    call: 'f(1)',
    chosen: 'bool',
  },
  {
    rule: 'a function without a rest parameter beats one with',
    overloads: ['fn f(a: int) -> bool: true', 'fn f(...xs: Array<int>) -> string: "c"'],
    call: 'f(1)',
    chosen: 'bool',
  },
  {
    rule: 'arguments past the fixed parameters take the function with a rest parameter',
    overloads: ['fn f(a: int) -> bool: true', 'fn f(...xs: Array<int>) -> string: "c"'],
    call: 'f(1, 2)',
    chosen: 'string',
  },
  {
    rule: 'a spread takes only the function with a rest parameter',
    overloads: ['fn f(a: int) -> bool: true', 'fn f(...xs: Array<int>) -> string: "c"'],
    call: 'f(...[1])',
    chosen: 'string',
  },
  {
    rule: 'a named argument rules out a function without a parameter of that name',
    overloads: ['fn f(a: int) -> bool: true', 'fn f(c: int, d: string) -> string: "c"'],
    call: 'f(d: "x", c: 1)',
    chosen: 'string',
  },
  {
    rule: 'a plain function takes the plain parameter over the async one',
    overloads: ['fn f(g: fn() -> int) -> bool: true', 'fn f(g: async fn() -> int) -> string: "c"'],
    setup: 'const g = fn() -> int: 1',
    call: 'f(g)',
    chosen: 'bool',
  },
  {
    rule: 'an async function takes only the async parameter',
    overloads: ['fn f(g: fn() -> int) -> bool: true', 'fn f(g: async fn() -> int) -> string: "c"'],
    setup: 'const g = async fn() -> Future<int>: 1',
    call: 'f(g)',
    chosen: 'string',
  },
];

/** The codes reported for `choice` with its overloads declared in `order`. */
function codesOf(choice: ChoiceCase, order: readonly string[]): readonly number[] {
  const expected = choice.chosen ?? 'int';
  const text = [
    ...order,
    'fn main():',
    ...(choice.setup === undefined ? [] : [`  ${choice.setup}`]),
    `  const result: ${expected} = ${choice.call}`,
  ].join('\n');
  return reported(text).codes;
}

/** Every order of `items`. */
function orders<Item>(items: readonly Item[]): readonly (readonly Item[])[] {
  if (items.length <= 1) {
    return [items];
  }
  return items.flatMap((item, index) =>
    orders([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
  );
}

describe('overload choice', () => {
  it.each(cases)('$rule', (choice) => {
    const ambiguous = [checkerDiagnostics.ambiguousCall.code];
    expect(codesOf(choice, choice.overloads)).toEqual(choice.chosen === undefined ? ambiguous : []);
  });

  it.each(cases)("doesn't depend on declaration order: $rule", (choice) => {
    const first = codesOf(choice, choice.overloads);
    for (const order of orders(choice.overloads)) {
      expect(codesOf(choice, order)).toEqual(first);
    }
  });
});
