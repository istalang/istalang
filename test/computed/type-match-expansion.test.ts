/**
 * Which type `match` reductions never end (§3.5, §3.17). An `infer` variable is a part of the
 * subject its case matched, so a use whose argument rebuilds the subject from those parts (`case
 * Node<infer T>: Data<Node<T>>`) is the subject again, a finite recursion, while one nesting the
 * subject deeper than it came in (`Box<Box<T>>` from `Box<infer T>`, `Array<T>` from `T`) grows
 * without end, directly or through another alias, reported at the alias whose case makes the use
 * that grows.
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { codesOf, runMain } from './computed.test-kit.ts';

const endless = checkerDiagnostics.endlessTypeMatch('' as never, '').code;

describe('a type match rebuilding its subject', () => {
  const rebuilt = [
    'struct Node<T> { value: T; next: Array<Node<T>> }',
    'type Data<D> = match D:',
    '  case Node<infer T>: { value: T; next: Array<Data<Node<T>>> }',
    '  case _: D',
  ];

  it('is a finite recursion, which checks and runs', () => {
    expect(codesOf(...rebuilt, 'fn probe(x: Data<Node<Int>>): ()')).toEqual([]);
    expect(
      runMain(
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
        'struct Node<T> { value: T; next: Array<Node<T>> }',
        'type Even<D> = match D:',
        '  case Node<infer T>: { value: T; next: Array<Odd<Node<T>>> }',
        '  case _: D',
        'type Odd<D> = match D:',
        '  case Node<infer T>: { value: T; next: Array<Even<Node<T>>> }',
        '  case _: D',
        'fn probe(x: Even<Node<Int>>): ()',
      ),
    ).toEqual([]);
  });
});
