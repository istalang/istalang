/**
 * Every value a body's flow computes has the type it holds (flow-ir.ts), so a rule reading the
 * flow, such as lifetimes deciding a function reaches no disposable at all, never meets a value of
 * no type in code checking accepted: literals, defaults, tests, parts read, calls the language
 * makes, and loops' items.
 */

import { describe, expect, it } from 'vitest';
import { subjectFlow } from './flow.test-kit.ts';

const bodies = [
  'const t = "n is {n} and {s}"',
  'for i in 0..n:\n  const m = i * 2',
  'for i in ..3:\n  const m = i',
  'const p = Point{x: 1, y: n}\nconst Point{x, y} = p\nconst q = Point{...p, y: x}',
  'const (a, b) = (n, s)\nmatch (n, c):\n  (1 | 2, true): ()\n  _: ()',
  'const xs = [1, 2, ...[n, n]]\nconst m = [...xs]',
  'const p = Point{x: 1, y: n}\nconst r = struct{for k, v in ...p: [k]: v + 1}',
  'match n:\n  0: ()\n  _: ()',
];

describe("a body's flow", () => {
  it.each(bodies)('gives each value a type in %s', (body) => {
    const untyped = subjectFlow(body).values.filter((value) => value.type === undefined);
    expect(untyped.map((value) => value.kind)).toEqual([]);
  });
});
