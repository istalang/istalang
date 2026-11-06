/**
 * Values (§3.1, §3.4, §3.7, §3.15) through the coordinator: the valid forms of struct literals,
 * tuples, destructuring, places, references and methods report nothing. Their errors are corpus
 * programs (`test/corpus/values/`), which state their positions; a warning, which the corpus
 * doesn't state, is checked here.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing, reportedOnce } from '../../diagnostics/diagnostic.test-kit.ts';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { diagnosedAt } from '../compile.test-kit.ts';
import { inFunction, reported } from './check.test-kit.ts';
import { checkerDiagnostics as reports } from './diagnostics/index.ts';

const pair = 'struct Pair { first: Int, second: Int }';
const apartFromChanging = /apart from the names that change/u;
const one = 'struct Id { value: String }';
const methods = [
  'fn grow(self: &Point, by: Int):\n  self.x += by',
  'fn sum(self: Point) -> Int: self.x + self.y',
  'fn bump(n: &Int):\n  n += 1',
].join('\n');

/**
 * `body` in a function beside `Pair`, `Id` and a few methods and functions on `Point` and `Int`.
 */
function inProgram(body: string): string {
  return `${pair}\n${one}\nstruct Empty\n${methods}\n${inFunction(body)}`;
}

describe('values warn', () => {
  it.each([
    [
      'of a let only read, its field reads not counting as changes',
      'let p = Point{x: 1, y: 2}\nconst q = p.x',
      'p',
    ],
    ['of each name of a destructuring let never changed', 'let a, b = (1, 2)\na = 3', 'b'],
  ])('%s', (_case, body, spanText) => {
    expect(reported(inProgram(body))).toEqual(
      reportedOnce(reports.letNeverReassigned.code, spanText),
    );
  });

  it.each([
    ['the whole let as a const when none of its names change', 'let u, v = (1, 2)', 2, false],
    ['a const of its own when another name changes', 'let a, b = (1, 2)\na = 3', 1, true],
  ])('suggesting %s', (_case, body, count, apart) => {
    const { diagnostics } = diagnosedAt(
      stdProgramOf({ 'main.ista': inProgram(body) }),
      'main.ista',
    );
    const messages = diagnostics.map(({ message }) => message);
    expect(messages).toHaveLength(count);
    expect(messages.map((message) => apartFromChanging.test(message))).toEqual(
      messages.map(() => apart),
    );
  });
});

describe('values accept', () => {
  it.each([
    [
      'every literal form',
      'const x = 1\nconst y = 2\nconst p = Point{x, y}\nconst q = Point{...p, y: 5}\nconst i = Id{"a"}\nconst j = Id{(s)}\nconst e = Empty',
    ],
    ['struct{…} taking the expected type', 'const p: Point = struct{x: 1, y: 2}'],
    [
      'struct{…} taking a spread value',
      'const p = Point{x: 1, y: 2}\nconst q = struct{...p, x: 3}\nconst r: Point = q',
    ],
    [
      'branches sharing the first one’s anonymous type',
      'const v = if c: struct{a: 1} else: struct{a: 2}\nconst w = v.a',
    ],
    [
      'an anonymous struct type taking a literal',
      'const v: { a: Int, b: String } = struct{a: 1, b: s}\nconst w = v.b',
    ],
    [
      'destructuring at any depth',
      'const (a, b), Pair{first, second as t} = ((1, 2), Pair{first: 3, second: 4})\nconst sum = a + b + first + t',
    ],
    [
      'assigning to tuples and structs of places',
      'let a = 0\nlet p = Pair{first: 0, second: 0}\n(a, p.first), Pair{second: p.second} = ((1, 2), Pair{first: 3, second: 4})',
    ],
    ['element and field assignment', 'let t = (1, Point{x: 1, y: 2})\nt.0 = 3\nt.1.x += 1'],
    [
      'references to variables, fields and elements',
      'let k = 1\nbump(&k)\nlet t = (1, 2)\nbump(&t.0)\nlet p = Point{x: 1, y: 2}\nbump(&p.x)',
    ],
    [
      'methods by value and by reference',
      'let p = Point{x: 1, y: 2}\np.grow(1)\nconst total = p.sum()',
    ],
    ['parenthesized targets', 'let x = 0\n(x) = 1\nlet y = 0\n((y, _)) = (3, 4)'],
  ])('%s', (_case, body) => {
    expect(reported(inProgram(body))).toEqual(reportedNothing);
  });

  it('a reference parameter passed on and changed through', () => {
    const text = 'fn bump(n: &Int):\n  n += 1\nfn twice(n: &Int):\n  bump(&n)\n  bump(&n)';
    expect(reported(text)).toEqual(reportedNothing);
  });

  it('a top-level constant destructured, each name its part', () => {
    const text = `${pair}\nconst lo, Pair{second as hi} = (1, Pair{first: 2, second: 3})\nfn f() -> Int: lo + hi`;
    expect(reported(text)).toEqual(reportedNothing);
  });
});
