/**
 * Which type `match` reductions never end (§8.1, §4.6). An `infer` variable is a part of the
 * subject its case matched, so a use whose argument rebuilds the subject from those parts (`case
 * Node<infer T>: Data<Node<T>>`) is the subject again, a finite recursion, while one nesting the
 * subject deeper than it came in (`Box<Box<T>>` from `Box<infer T>`, `Array<T>` from `T`) grows
 * without end, directly or through another alias, reported at the alias whose case makes the use
 * that grows.
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { codesOf, runMain } from '../written-types.test-kit.ts';

const endless = checkerDiagnostics.endlessTypeMatch('' as never, '').code;

describe('a type match rebuilding its subject', () => {
  const rebuilt = [
    'struct Node<T> { value: T, next: Array<Node<T>> }',
    'type Data<D> = match D:',
    '  case Node<infer T>: { value: T, next: Array<Data<Node<T>>> }',
    '  case _: D',
  ];

  it('is a finite recursion, which checks and runs', async () => {
    expect(codesOf(...rebuilt, 'fn probe(x: Data<Node<Int>>): ()')).toEqual([]);
    expect(
      await runMain(
        'Int',
        'total(struct{value: 1, next: [struct{value: 2, next: []}, struct{value: 3, next: []}]})',
        [
          ...rebuilt,
          'fn total(d: Data<Node<Int>>) -> Int:',
          '  let sum = d.value',
          '  for each in d.next:',
          '    sum += total(each)',
          '  sum',
        ],
      ),
    ).toBe(6);
  });

  it('is finite when a tuple subject is rebuilt part by part', () => {
    expect(
      codesOf(
        'struct Box<T> { value: T }',
        'type Swap<A, B> = match (A, B):',
        '  case (Box<infer X>, infer Y): Swap<Y, Box<X>>',
        '  case _: A',
        'fn probe(x: Swap<Box<Int>, String>): ()',
      ),
    ).toEqual([]);
  });
});

describe('a type match growing its subject', () => {
  it('is endless when an argument nests the subject deeper', () => {
    expect(
      codesOf('type W<T> = match T:', '  case _: W<Array<T>>', 'fn probe(x: W<Int>): ()'),
    ).toEqual([endless]);
    expect(
      codesOf(
        'struct Box<T> { value: T }',
        'type D2<D> = match D:',
        '  case Box<infer T>: D2<Box<Box<T>>>',
        '  case _: D',
        'fn probe(x: D2<Box<Int>>): ()',
      ),
    ).toEqual([endless]);
  });

  it('is endless through another alias, and finite when neither grows', () => {
    expect(
      codesOf(
        'type Ping<T> = match T:',
        '  case _: Pong<(T,)>',
        'type Pong<U> = match U:',
        '  case _: Ping<U>',
        'fn probe(x: Ping<Int>): ()',
      ),
    ).toEqual([endless]);
    expect(
      codesOf(
        'struct Node<T> { value: T, next: Array<Node<T>> }',
        'type Even<D> = match D:',
        '  case Node<infer T>: { value: T, next: Array<Odd<Node<T>>> }',
        '  case _: D',
        'type Odd<D> = match D:',
        '  case Node<infer T>: { value: T, next: Array<Even<Node<T>>> }',
        '  case _: D',
        'fn probe(x: Even<Node<Int>>): ()',
      ),
    ).toEqual([]);
  });
});

describe('an associated type whose body is a type `match`', () => {
  it('reduces, recurses and grows as an alias whose body is one does', async () => {
    const owner = (body: string) => ['struct W<T>:', '  value: T', '  type Grow = match T:', body];
    expect(codesOf(...owner('    case _: W<Array<T>>.Grow'), 'fn f(x: W<Int>.Grow): ()')).toEqual(
      codesOf('type G<T> = match T:', '  case _: G<Array<T>>', 'fn f(x: G<Int>): ()'),
    );
    expect(codesOf(...owner('    case _: W<T>.Grow'), 'fn f(x: W<Int>.Grow): ()')).toEqual(
      codesOf('type G<T> = match T:', '  case _: G<T>', 'fn f(x: G<Int>): ()'),
    );
    const flat = [
      'struct Box<T>:',
      '  value: T',
      '  type Flat = match T:',
      '    case Box<infer U>: Box<U>.Flat',
      '    case _: { leaf: T, next: Array<Flat> }',
      'fn f(x: Box<Box<Int>>.Flat) -> Int: x.leaf + x.next.length()',
    ];
    expect(await runMain('Int', 'f(struct{leaf: 3, next: []})', flat)).toBe(3);
  });
});
