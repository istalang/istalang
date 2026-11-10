/**
 * Choosing among overloads (§3.7), seen through which result a call gets: each overload of `f`
 * returns a type of its own. The choice follows the rules case by case, and never depends on the
 * order the overloads are declared in.
 */

import { describe, expect, it, vi } from 'vitest';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import { checkedApart, reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { typeText } from '../../types/type/type-text.ts';

interface ChoiceCase {
  readonly rule: string;
  readonly overloads: readonly string[];
  readonly call: string;
  /** What the call needs declared before it. */
  readonly setup?: string;
  /** The result type of the overload the call must choose; undefined when it is ambiguous. */
  readonly chosen: string | undefined;
  /** Whether the overloads clash where declared, as two some call fits alike do (§3.7). */
  readonly clash?: boolean;
}

const cases: readonly ChoiceCase[] = [
  {
    rule: 'the most specific beats a function taking a union holding its parameter',
    overloads: ['fn f(a: Int) -> String: "narrow"', 'fn f(a: Int?) -> Bool: true'],
    call: 'f(1)',
    chosen: 'String',
  },
  {
    rule: 'a function taking a union is chosen for a value only it takes',
    overloads: ['fn f(a: Int) -> String: "narrow"', 'fn f(a: Int?) -> Bool: true'],
    call: 'f(none)',
    chosen: 'Bool',
  },
  {
    rule: "the most specific beats a function taking a literal type's base",
    overloads: ['fn f(a: "a") -> String: "literal"', 'fn f(a: String) -> Bool: true'],
    call: 'f("a")',
    chosen: 'String',
  },
  {
    rule: 'a generic function taking a plain function as it is beats one making it async when T is inferred contravariantly',
    overloads: [
      'fn f<T>(g: fn(T) -> Unit) -> String: "sync"',
      'fn f<T>(g: ista async fn(T) -> Unit) -> Bool: true',
    ],
    setup: 'const h: fn(Int) -> Unit = fn(_: Int): ()',
    call: 'f(h)',
    chosen: 'String',
  },
  {
    rule: 'a concrete function beats a generic one inferred',
    overloads: ['fn f<T>(a: T) -> Bool: true', 'fn f(a: Int) -> String: "c"'],
    call: 'f(5)',
    chosen: 'String',
  },
  {
    rule: 'explicit type arguments choose among generic functions only',
    overloads: ['fn f<T>(a: T) -> Bool: true', 'fn f(a: Int) -> String: "c"'],
    call: 'f<Int>(5)',
    chosen: 'Bool',
  },
  {
    rule: 'a generic function is chosen when it alone matches',
    overloads: ['fn f<T>(a: T) -> Bool: true', 'fn f(a: Int) -> String: "c"'],
    call: 'f("x")',
    chosen: 'Bool',
  },
  {
    rule: 'only functions taking that many type arguments are considered',
    overloads: ['fn f<T>(a: T) -> Bool: true', 'fn f<T, U>(a: T) -> String: "c"'],
    call: 'f<Int, String>(5)',
    chosen: 'String',
  },
  {
    rule: 'two generic functions both matching are ambiguous, and clash',
    overloads: ['fn f<T>(a: T, b: Int) -> Bool: true', 'fn f<T>(a: Int, b: T) -> String: "c"'],
    call: 'f(1, 2)',
    chosen: undefined,
    clash: true,
  },
  {
    rule: 'a value fits an optional parameter by the implicit wrap',
    overloads: ['fn f(a: Int?) -> Bool: true', 'fn f(a: String) -> String: "c"'],
    call: 'f(1)',
    chosen: 'Bool',
  },
  {
    rule: "the '&' at the call tells a reference parameter from a value one",
    overloads: ['fn f(a: Int) -> Bool: true', 'fn f(a: &Int) -> String: "c"'],
    call: 'f(&n)',
    setup: 'let n = 1',
    chosen: 'String',
  },
  {
    rule: 'an argument the call decides takes only a parameter of a type it can be',
    overloads: ['fn f(a: Array<Int>) -> Bool: true', 'fn f(a: Int) -> String: "c"'],
    call: 'f([])',
    chosen: 'Bool',
  },
  {
    rule: 'a tuple holding none takes only a tuple with an optional there',
    overloads: ['fn f(a: (Int, Int?)) -> Bool: true', 'fn f(a: (Int, String)) -> String: "c"'],
    call: 'f((1, none))',
    chosen: 'Bool',
  },
  {
    rule: 'a tuple holding none keeps the types of its other elements',
    overloads: ['fn f(a: (Int, Int?)) -> Bool: true', 'fn f(a: (String, Int?)) -> String: "c"'],
    call: 'f((1, none))',
    chosen: 'Bool',
  },
  {
    rule: 'an array literal holding none in any position keeps the types of its other elements',
    overloads: ['fn f(a: Array<Int?>) -> Bool: true', 'fn f(a: Array<String?>) -> String: "c"'],
    call: 'f(["a", none])',
    chosen: 'String',
  },
  {
    rule: 'an array literal starting with none keeps the types of its later elements',
    overloads: ['fn f(a: Array<Int?>) -> Bool: true', 'fn f(a: Array<String?>) -> String: "c"'],
    call: 'f([none, "a"])',
    chosen: 'String',
  },
  {
    rule: 'a map literal holding none keeps the types of its keys',
    overloads: [
      'fn f(a: Map<Int, Int?>) -> Bool: true',
      'fn f(a: Map<String, Int?>) -> String: "c"',
    ],
    call: 'f(["a": none])',
    chosen: 'String',
  },
  {
    rule: 'an if expression holding none in any branch keeps the types of its other branches',
    overloads: ['fn f(a: Int?) -> Bool: true', 'fn f(a: String?) -> String: "c"'],
    call: 'f(if true: "a" else: none)',
    chosen: 'String',
  },
  {
    rule: 'a tuple holding none fits an optional tuple parameter',
    overloads: ['fn f(a: (Int, Int?)?) -> Bool: true', 'fn f(a: String?) -> String: "c"'],
    call: 'f((1, none))',
    chosen: 'Bool',
  },
  {
    rule: 'a tuple holding an anonymous struct literal and none guides the struct literal',
    overloads: [
      'fn f(a: ({ a: Int }, Int?)) -> Bool: true',
      'fn f(a: (Int, String)) -> String: "c"',
    ],
    call: 'f((struct{a: 1}, none))',
    chosen: 'Bool',
  },
  {
    rule: 'an anonymous struct literal fits its own shape exactly, over a struct it converts to',
    overloads: [
      'struct Pixel { x: Int, y: Int }\nfn f(p: Pixel) -> String: "nominal"',
      'fn f(p: { x: Int, y: Int }) -> Bool: true',
    ],
    call: 'f(struct{x: 1, y: 2})',
    chosen: 'Bool',
  },
  {
    rule: 'an anonymous struct literal fits its own shape exactly, over a struct a default fills',
    overloads: [
      'struct WithDefault { x: Int, y: Int = 0 }\nfn f(p: WithDefault) -> String: "nominal"',
      'fn f(p: { x: Int }) -> Bool: true',
    ],
    call: 'f(struct{x: 1})',
    chosen: 'Bool',
  },
  {
    rule: 'a bare variant fits an optional enum parameter',
    overloads: [
      'enum Color { Red, Blue }\nfn f(a: Color?) -> Bool: true',
      'fn f(a: Int?) -> String: "c"',
    ],
    call: 'f(Red)',
    chosen: 'Bool',
  },
  {
    rule: 'an overloaded function value fits an optional function parameter',
    overloads: [
      'fn g(x: Int) -> Int: x\nfn g(x: String) -> String: x\nfn f(a: (fn(Int) -> Int)?) -> Bool: true',
      'fn f(a: Int?) -> String: "c"',
    ],
    call: 'f(g)',
    chosen: 'Bool',
  },
  {
    rule: 'a lambda in an array takes only an array of functions of its arity',
    overloads: [
      'fn f(a: Array<fn(Int) -> Int>) -> Bool: true',
      'fn f(a: Array<fn(Int, Int) -> Int>) -> String: "c"',
    ],
    call: 'f([fn(x): x])',
    chosen: 'Bool',
  },
  {
    rule: 'an empty [] takes an array and a map alike',
    overloads: ['fn f(a: Array<Int>) -> Bool: true', 'fn f(a: Map<String, Int>) -> String: "c"'],
    call: 'f([])',
    chosen: undefined,
  },
  {
    rule: 'a call leaving a parameter to its default chooses the function with it',
    overloads: ['fn f(a: Int, b: Int = 1) -> Bool: true', 'fn f(a: String) -> String: "c"'],
    call: 'f(1)',
    chosen: 'Bool',
  },
  {
    rule: 'a function without a rest parameter beats one with',
    overloads: ['fn f(a: Int) -> Bool: true', 'fn f(...xs: Array<Int>) -> String: "c"'],
    call: 'f(1)',
    chosen: 'Bool',
  },
  {
    rule: 'arguments past the fixed parameters take the function with a rest parameter',
    overloads: ['fn f(a: Int) -> Bool: true', 'fn f(...xs: Array<Int>) -> String: "c"'],
    call: 'f(1, 2)',
    chosen: 'String',
  },
  {
    rule: 'a spread takes only the function with a rest parameter',
    overloads: ['fn f(a: Int) -> Bool: true', 'fn f(...xs: Array<Int>) -> String: "c"'],
    call: 'f(...[1])',
    chosen: 'String',
  },
  {
    rule: 'a named argument rules out a function without a parameter of that name',
    overloads: ['fn f(a: Int) -> Bool: true', 'fn f(c: Int, d: String) -> String: "c"'],
    call: 'f(d: "x", c: 1)',
    chosen: 'String',
  },
  {
    rule: 'a plain function takes the plain parameter over the async one',
    overloads: [
      'fn f(g: fn() -> Int) -> Bool: true',
      'fn f(g: ista async fn() -> Int) -> String: "c"',
    ],
    setup: 'const g = fn() -> Int: 1',
    call: 'f(g)',
    chosen: 'Bool',
  },
  {
    rule: 'an async function takes only the async parameter',
    overloads: [
      'fn f(g: fn() -> Int) -> Bool: true',
      'fn f(g: ista async fn() -> Int) -> String: "c"',
    ],
    setup: 'const g = async fn() -> Future<Int, "ista">: 1',
    call: 'f(g)',
    chosen: 'String',
  },
];

/** The codes reported for `choice` with its overloads declared in `order`. */
function codesOf(choice: ChoiceCase, order: readonly string[]): readonly number[] {
  const expected = choice.chosen ?? 'Int';
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
    const clash = choice.clash === true ? [checkerDiagnostics.overloadClash.code] : [];
    const ambiguous = choice.chosen === undefined ? [checkerDiagnostics.ambiguousCall.code] : [];
    expect(codesOf(choice, choice.overloads)).toEqual([...clash, ...ambiguous]);
  });

  it.each(cases)("doesn't depend on declaration order: $rule", (choice) => {
    const first = codesOf(choice, choice.overloads);
    for (const order of orders(choice.overloads)) {
      expect(codesOf(choice, order)).toEqual(first);
    }
  });
});

/** How often checking a call `f(5)` among `overloads` asks whether an `Int` fits a type. */
function intFitsAsked(overloads: readonly string[]): number {
  const source = [...overloads, 'fn main() -> String: f(5)'].join('\n');
  const checker = checkedApart(stdProgramOf({ 'main.ista': source }));
  const fitOf = vi.spyOn(checker, 'fitOf');
  checker.diagnosticsOf(idOf('main.ista'));
  return fitOf.mock.calls.filter(([found]) => typeText(found) === 'Int').length;
}

describe('ranking the candidates that apply', () => {
  it('asks how an argument fits only to break a tie the earlier ranks leave', () => {
    const alone = intFitsAsked(['fn f(a: Int) -> String: "c"']);
    const beatingGeneric = intFitsAsked([
      'fn f<T>(a: T) -> Bool: true',
      'fn f(a: Int) -> String: "c"',
    ]);
    expect(beatingGeneric).toBe(alone);
  });
});
