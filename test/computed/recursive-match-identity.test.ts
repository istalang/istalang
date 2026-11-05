/**
 * A recursive type `match` use is a recursive type like any other (§3.17,
 * docs/work/proposals/p5-equi-recursive-identity.md, stage 2): closed through the one constructor,
 * it is one type with a recursive alias of its structure, and with another use reducing alike.
 */

import { describe, expect, it } from 'vitest';
import { codesOf, runMain } from './computed.test-kit.ts';

const dataDecls = [
  'struct Node<T> { value: T, next: Array<Node<T>> }',
  'type Data<D> = match D:',
  '  case Node<infer T>: { value: T, next: Array<Data<D>> }',
];

describe('a recursive type `match` use', () => {
  it('is one type with a recursive alias of its structure, both ways', () => {
    const declarations = [
      ...dataDecls,
      'type Chain = { value: Int, next: Array<Chain> }',
      'fn toChain(d: Data<Node<Int>>) -> Chain: d',
      'fn toData(c: Chain) -> Data<Node<Int>>: c',
    ];
    expect(codesOf(...declarations)).toEqual([]);
    expect(
      runMain(
        'Int',
        'toData(toChain(struct{value: 3, next: [struct{value: 4, next: []}]})).next.length()',
        declarations,
      ),
    ).toBe(1);
  });

  it('is one type with another use whose reduction unfolds alike', () => {
    const declarations = [
      ...dataDecls,
      'struct Pair<T> { value: T, next: Array<Pair<T>> }',
      'type Other<D> = match D:',
      '  case Pair<infer T>: { value: T, next: Array<Other<D>> }',
      'fn cross(d: Data<Node<String>>) -> Other<Pair<String>>: d',
    ];
    expect(codesOf(...declarations)).toEqual([]);
  });
});
