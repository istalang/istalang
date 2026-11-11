/**
 * The M2.4 subset as a hand-written Definition: primitives through prelude externs, functions,
 * `let`/`const`, `if`/`while`/`return` and a struct. `main` returns 98: the sum of fib(0..9)
 * is 88, plus the loop counter's final 10.
 *
 * Arithmetic and comparisons are calls to prelude externs, and `<` is `compare` followed by
 * `order`, as the lowering will emit them (docs/arch/definition.md).
 */

import type { Definition } from '../../src/definition/definition.ts';
import {
  externFunction,
  functionCallee,
  int,
  sourceModule,
  spanOf,
  valueArgument as v,
} from './fixture-kit.ts';

export const subsetSource = `struct Point { x: Int, y: Int }

fn fib(n: Int) -> Int:
  if n < 2:
    return n
  fib(n - 1) + fib(n - 2)

live async fn main():
  let total = 0
  let i = 0
  while i < 10:
    total = total + fib(i)
    i = i + 1
  const p = Point{x: total, y: i}
  p.x + p.y
`;

export const subsetOutcome = 98n;

const at = (snippet: string) => spanOf(subsetSource, snippet);

const [compare, add, subtract, fib, main] = [0, 1, 2, 3, 4];
const [zero, one, two, ten] = [0, 1, 2, 3];
const point = 0;

export const subsetDefinition: Definition = {
  modules: [sourceModule('main', subsetSource), sourceModule('prelude')],
  types: [
    {
      kind: 'struct',
      name: 'main.Point',
      arguments: [],
      fields: [
        { name: 'x', type: int, annotations: [] },
        { name: 'y', type: int, annotations: [] },
      ],
    },
  ],
  constants: [0n, 1n, 2n, 10n],
  starts: [],
  main,
  functions: [
    externFunction({
      module: 1,
      key: 'prelude.compare(Int, Int)',
      parameters: [int, int],
      result: int,
    }),
    externFunction({
      module: 1,
      key: 'prelude.add(Int, Int)',
      parameters: [int, int],
      result: int,
    }),
    externFunction({
      module: 1,
      key: 'prelude.subtract(Int, Int)',
      parameters: [int, int],
      result: int,
    }),
    {
      kind: 'code',
      name: 'main.fib',
      module: 0,
      span: at('fn fib(n: Int) -> Int'),
      mode: 'simple',
      parameters: [{ reference: false, hasDefault: false }],
      captures: 0,
      annotations: [],
      registers: 10,
      cells: [],
      instructions: [
        { kind: 'constant', span: at('2'), dst: 1, constant: two },
        {
          kind: 'call',
          span: at('n < 2'),
          dst: 2,
          callee: functionCallee(compare),
          arguments: [v(0), v(1)],
        },
        { kind: 'order', span: at('n < 2'), dst: 3, comparison: 2, relation: 'less' },
        { kind: 'branch', span: at('if n < 2'), condition: 3, whenTrue: 4, whenFalse: 5 },
        { kind: 'return', span: at('return n'), value: 0 },
        { kind: 'constant', span: at('1'), dst: 4, constant: one },
        {
          kind: 'call',
          span: at('n - 1'),
          dst: 5,
          callee: functionCallee(subtract),
          arguments: [v(0), v(4)],
        },
        {
          kind: 'call',
          span: at('fib(n - 1)'),
          dst: 6,
          callee: functionCallee(fib),
          arguments: [v(5)],
        },
        {
          kind: 'call',
          span: at('n - 2'),
          dst: 7,
          callee: functionCallee(subtract),
          arguments: [v(0), v(1)],
        },
        {
          kind: 'call',
          span: at('fib(n - 2)'),
          dst: 8,
          callee: functionCallee(fib),
          arguments: [v(7)],
        },
        {
          kind: 'call',
          span: at('fib(n - 1) + fib(n - 2)'),
          dst: 9,
          callee: functionCallee(add),
          arguments: [v(6), v(8)],
        },
        { kind: 'return', span: at('fib(n - 1) + fib(n - 2)'), value: 9 },
      ],
    },
    {
      kind: 'code',
      name: 'main.main',
      module: 0,
      span: at('live async fn main()'),
      mode: 'live',
      parameters: [],
      captures: 0,
      annotations: [],
      registers: 11,
      cells: [],
      instructions: [
        { kind: 'constant', span: at('let total = 0'), dst: 0, constant: zero },
        { kind: 'constant', span: at('let i = 0'), dst: 1, constant: zero },
        { kind: 'constant', span: at('10'), dst: 2, constant: ten },
        {
          kind: 'call',
          span: at('i < 10'),
          dst: 3,
          callee: functionCallee(compare),
          arguments: [v(1), v(2)],
        },
        { kind: 'order', span: at('i < 10'), dst: 4, comparison: 3, relation: 'less' },
        { kind: 'branch', span: at('while i < 10'), condition: 4, whenTrue: 6, whenFalse: 11 },
        {
          kind: 'call',
          span: at('fib(i)'),
          dst: 5,
          callee: functionCallee(fib),
          arguments: [v(1)],
        },
        {
          kind: 'call',
          span: at('total + fib(i)'),
          dst: 0,
          callee: functionCallee(add),
          arguments: [v(0), v(5)],
        },
        { kind: 'constant', span: at('1\n'), dst: 6, constant: one },
        {
          kind: 'call',
          span: at('i + 1'),
          dst: 1,
          callee: functionCallee(add),
          arguments: [v(1), v(6)],
        },
        { kind: 'jump', span: at('while i < 10'), target: 3 },
        {
          kind: 'struct',
          span: at('Point{x: total, y: i}'),
          dst: 7,
          type: point,
          fields: [0, 1],
        },
        { kind: 'field', span: at('p.x'), dst: 8, src: 7, index: 0 },
        { kind: 'field', span: at('p.y'), dst: 9, src: 7, index: 1 },
        {
          kind: 'call',
          span: at('p.x + p.y'),
          dst: 10,
          callee: functionCallee(add),
          arguments: [v(8), v(9)],
        },
        { kind: 'return', span: at('p.x + p.y'), value: 10 },
      ],
    },
  ],
};
