/**
 * A recursive type `match` use is a recursive type like any other (§3.17,
 * docs/work/proposals/p5-equi-recursive-identity.md, stage 2): closed through the one constructor,
 * it is one type with a recursive alias of its structure, and with another use reducing alike.
 */

import { describe, expect, it } from 'vitest';
import {
  codesOf,
  compareWrittenTypes,
  hoverCodeAt,
  runMain,
  sameComputedType,
} from './computed.test-kit.ts';

const dataDecls = [
  'struct Node<T> { value: T, next: Array<Node<T>> }',
  'type Data<D> = match D:',
  '  case Node<infer T>: { value: T, next: Array<Data<D>> }',
];

describe('a recursive type `match` use', () => {
  it('is one type with a recursive alias of its structure, both ways', async () => {
    const declarations = [
      ...dataDecls,
      'type Chain = { value: Int, next: Array<Chain> }',
      'fn toChain(d: Data<Node<Int>>) -> Chain: d',
      'fn toData(c: Chain) -> Data<Node<Int>>: c',
    ];
    expect(codesOf(...declarations)).toEqual([]);
    expect(
      await runMain(
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

  it('reduces a type `match` its own use is given inside its body, once that use is closed', async () => {
    const declarations = [
      'struct Node { v: Int }',
      'type Wrap<X> = match X:',
      '  case struct { n: infer K }: K',
      '  case _: String',
      'type A<D> = match D:',
      '  case Node: { w: Array<Wrap<A<D>>>, n: Int }',
      'fn first(a: A<Node>) -> Int: a.w[0] + a.n',
    ];
    expect(codesOf(...declarations)).toEqual([]);
    expect(await runMain('Int', 'first(struct{w: [5], n: 2})', declarations)).toBe(7);
  });

  it('closes a type `match` its own use is given inside its body when it holds itself in turn', async () => {
    const declarations = [
      'struct Node { v: Int }',
      'type Box<X> = match X:',
      '  case struct { w: infer W }: { inner: W }',
      'type A<D> = match D:',
      '  case Node: { w: Array<Box<A<D>>>, n: Int }',
      'fn depth(a: A<Node>) -> Int: a.w.length() + a.w[0].inner[0].inner.length()',
    ];
    expect(codesOf(...declarations)).toEqual([]);
    expect(
      await runMain(
        'Int',
        'depth(struct{w: [struct{inner: [struct{inner: []}]}], n: 1})',
        declarations,
      ),
    ).toBe(1);
  });

  it('matches a recursive type as what it unfolds to, as a subject and as a pattern', () => {
    const declarations = [
      'type Tree = { n: Int, kids: Array<Tree> }',
      'type Rose = Array<Rose>',
      'type IdOf<X> = match X:',
      '  case struct { n: infer K }: K',
      '  case _: String',
      'type ItemOf<X> = match X:',
      '  case Array<infer T>: T',
      '  case _: String',
      'type IsTree<X> = match X:',
      '  case Tree: "tree"',
      '  case _: "other"',
    ];
    expect(compareWrittenTypes('IdOf<Tree>', 'Int', declarations)).toEqual(sameComputedType);
    expect(compareWrittenTypes('ItemOf<Rose>', 'Rose', declarations)).toEqual(sameComputedType);
    expect(
      compareWrittenTypes('IsTree<{ n: Int, kids: Array<Tree> }>', '"tree"', declarations),
    ).toEqual(sameComputedType);
    expect(compareWrittenTypes('IsTree<{ n: Int }>', '"other"', declarations)).toEqual(
      sameComputedType,
    );
  });

  it('reads, inside itself too, as the associated type it was written through', () => {
    const model = [
      'trait Node:',
      '  type Data',
      'struct Field<T>:',
      '  value: T?',
      '  type Data = T',
      'struct List<R is Node>:',
      '  rows: Array<R>',
      '  type Data = Array<R.Data>',
      'struct Group<S is struct { [_] is Node }>:',
      '  fields: S',
      '  type Data = match S:',
      '    case _: { [F in keyof S]: S[F].Data }',
      'struct Category:',
      '  name: Field<String>',
      '  children: List<Group<Category>>',
    ];
    const hover = (read: string) =>
      hoverCodeAt(...model, 'fn f(d: Group<Category>.Data):', `  const ‸a = ${read}`, '  _ = a');
    expect(codesOf(...model)).toEqual([]);
    expect(hover('d')).toEqual(['(variable) a: Group<Category>.Data']);
    expect(hover('d.children')).toEqual(['(variable) a: Array<Group<Category>.Data>']);
    expect(hover('d.children[0]')).toEqual(['(variable) a: Group<Category>.Data']);
  });
});
