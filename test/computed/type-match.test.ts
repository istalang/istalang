/**
 * Type `match` (§3.17, docs/proposals/4-computed-types.md §4): in aliases and associated types,
 * tuple subjects, `infer` (repeated and constrained), exact matching with the literal-to-base
 * exception, `case struct` vs `case { … }`, union distribution and `Never`, generic reduction vs
 * opaqueness, finite recursive type `match` (`DataOf<Tree>`), and endless reductions
 * (`W<T> -> W<Array<T>>`), judged by the expansion graph (pre-P4 debt #1).
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { codesOf, compareWrittenTypes, runMain, sameComputedType } from './computed.test-kit.ts';

const schemaDecls = [
  'trait FormNode:',
  '  type Data',
  '  fn validate(self: Self, data: Self.Data) -> Array<String>',
  'struct Field<T>:',
  '  value: T?',
  '  type Data = T',
  'fn validate<T>(self: Field<T>, data: T) -> Array<String>: []',
  'struct Repeat<Row is FormNode>:',
  '  row: Row',
  '  type Data = Array<Row.Data>',
  'fn validate<R is FormNode>(self: Repeat<R>, data: Array<R.Data>) -> Array<String>: []',
  'struct Group<S is struct { [_] is FormNode }>:',
  '  fields: S',
  '  type Data = { [F in keyof S]: S[F].Data }',
  'fn validate<S is struct { [_] is FormNode }>(self: Group<S>, data: Group<S>.Data) -> Array<String>: []',
  'struct OrderForm:',
  '  country: Field<String>',
  '  items: Repeat<Group<{ sku: Field<String>, qty: Field<Int> }>>',
];

describe('type `match` (§4 and pre-P4 debt #1)', () => {
  const dataOfDecls = [
    ...schemaDecls,
    'type DataOf<D> = match D:',
    '  case Field<infer T>: T',
    '  case Repeat<infer R>: Array<DataOf<R>>',
    '  case Group<infer S>: DataOf<S>',
    '  case struct: { [F in keyof D]: DataOf<D[F]> }',
  ];

  it('computes `DataOf<OrderForm>` identically to `Group<OrderForm>.Data`, and works in associated types too', () => {
    const decls = [
      ...dataOfDecls,
      'struct Wrapper<D>:',
      '  type Out = match D:',
      '    case Field<infer T>: Array<T>',
      '    case _: D',
    ];
    expect(compareWrittenTypes('DataOf<OrderForm>', 'Group<OrderForm>.Data', decls)).toEqual(
      sameComputedType,
    );
    expect(compareWrittenTypes('Wrapper<Field<Int>>.Out', 'Array<Int>', decls)).toEqual(
      sameComputedType,
    );
    expect(compareWrittenTypes('Wrapper<String>.Out', 'String', decls)).toEqual(sameComputedType);
  });

  it('matches tuple subjects `match (A, B):`, repeated `infer T`, and constrained `infer T is C`', () => {
    const decls = [
      'struct Pair<A, B> { first: A, second: B }',
      'struct Box<T> { value: T }',
      'type SamePair<P> = match P:',
      '  case Pair<infer T, T>: Array<T>',
      '  case Pair<infer A, infer B>: (A, B)',
      'type SendablePayload<B> = match B:',
      '  case Box<infer T is Sendable>: T',
      '  case _: None',
      'type ZipPair<A, B> = match (A, B):',
      '  case (Field<infer X>, Field<infer Y>): (X, Y)',
      '  case _: Never',
      ...schemaDecls,
    ];
    expect(compareWrittenTypes('SamePair<Pair<Int, Int>>', 'Array<Int>', decls)).toEqual(
      sameComputedType,
    );
    expect(compareWrittenTypes('SamePair<Pair<Int, String>>', '(Int, String)', decls)).toEqual(
      sameComputedType,
    );
    expect(compareWrittenTypes('SendablePayload<Box<Int>>', 'Int', decls)).toEqual(
      sameComputedType,
    );
    expect(compareWrittenTypes('SendablePayload<Box<Slot<Int>>>', 'None', decls)).toEqual(
      sameComputedType,
    );
    expect(
      compareWrittenTypes('ZipPair<Field<Int>, Field<String>>', '(Int, String)', decls),
    ).toEqual(sameComputedType);
  });

  it('matches `case struct { … }:` openly (extracting `infer`), while `case { … }:` matches the exact shape only', () => {
    const decls = [
      'struct NominalId { id: Int, extra: String }',
      'type IdOf<T> = match T:',
      '  case struct { id: infer K }: K',
      '  case _: None',
      'type ExactShape<T> = match T:',
      '  case { id: Int }: "exact"',
      '  case struct { id: Int }: "open-struct"',
      '  case _: "other"',
    ];
    expect(compareWrittenTypes('IdOf<NominalId>', 'Int', decls)).toEqual(sameComputedType);
    expect(compareWrittenTypes('IdOf<{ id: String, count: Int }>', 'String', decls)).toEqual(
      sameComputedType,
    );
    expect(compareWrittenTypes('IdOf<Int>', 'None', decls)).toEqual(sameComputedType);

    expect(compareWrittenTypes('ExactShape<{ id: Int }>', '"exact"', decls)).toEqual(
      sameComputedType,
    );
    expect(
      compareWrittenTypes('ExactShape<{ id: Int, extra: Bool }>', '"open-struct"', decls),
    ).toEqual(sameComputedType);
    expect(
      compareWrittenTypes('ExactShape<OnlyId>', '"open-struct"', [
        ...decls,
        'struct OnlyId { id: Int }',
      ]),
    ).toEqual(sameComputedType);
  });

  it('matches exactly (no union or 1-tuple conversion), except a literal type matches its base type (`Bool` matches `case Bool:`)', () => {
    const decls = [
      'type Classify<T> = match T:',
      '  case (Int,): "one-tuple"',
      '  case Bool: "bool"',
      '  case Int: "int"',
      '  case String: "string"',
      '  case _: "other"',
    ];
    expect(compareWrittenTypes('Classify<(Int,)>', '"one-tuple"', decls)).toEqual(sameComputedType);
    expect(compareWrittenTypes('Classify<Int>', '"int"', decls)).toEqual(sameComputedType);
    expect(compareWrittenTypes('Classify<42>', '"int"', decls)).toEqual(sameComputedType);
    expect(compareWrittenTypes('Classify<"draft">', '"string"', decls)).toEqual(sameComputedType);
    expect(compareWrittenTypes('Classify<true>', '"bool"', decls)).toEqual(sameComputedType);
    expect(compareWrittenTypes('Classify<Bool>', '"bool"', decls)).toEqual(sameComputedType);
  });

  it('distributes over a union subject, gives `Never` for `Never`, and matches a tuple `(D,)` whole without distributing', () => {
    const decls = [
      ...dataOfDecls,
      'type WholeOrUnion<D> = match (D,):',
      '  case (Int | String,): "whole-union"',
      '  case (Int,): "int-only"',
      '  case _: "other"',
    ];
    expect(
      compareWrittenTypes('DataOf<Field<Int> | Field<String>>', 'Int | String', decls),
    ).toEqual(sameComputedType);
    expect(compareWrittenTypes('DataOf<Never>', 'Never', decls)).toEqual(sameComputedType);
    expect(compareWrittenTypes('WholeOrUnion<Int | String>', '"whole-union"', decls)).toEqual(
      sameComputedType,
    );
  });

  it('reduces in a generic body when the first possible case always matches, and stays opaque otherwise', () => {
    const decls = [
      ...dataOfDecls,
      // `DataOf<Field<T>>` always matches the first case `case Field<infer T>: T`, so it reduces to `T`
      'fn unwrapFieldData<T>(x: DataOf<Field<T>>) -> T: x',
      // `DataOf<D>` for unconstrained `D` cannot reduce yet: equal to `DataOf<D>`, not to `D`
      'fn keepUnreduced<D>(x: DataOf<D>) -> DataOf<D>: x',
    ];
    expect(runMain('Int', 'unwrapFieldData<Int>(15) + keepUnreduced<Field<Int>>(27)', decls)).toBe(
      42,
    );

    expect(codesOf(...dataOfDecls, 'fn badOpaque<D>(x: DataOf<D>) -> D: x')).toEqual([
      checkerDiagnostics.typeMismatch.code,
    ]);

    expect(
      codesOf(...dataOfDecls, 'fn badOtherOpaque<A, B>(x: DataOf<A>) -> DataOf<B>: x'),
    ).toEqual([checkerDiagnostics.typeMismatch.code]);
  });

  it('supports finite recursive type `match` (`DataOf<Tree>`) and reports endless reductions (`W<T> -> W<Array<T>>`) (pre-P4 debt #1)', () => {
    // `Tree` is finite (§3.1): its children sit in a collection, which a `Repeat`'s single row
    // isn't, so the recursive schema maps a `Many` of rows.
    const recursiveDecls = [
      'struct Field<T> { value: T? }',
      'struct Many<Row> { rows: Array<Row> }',
      'type TreeOf<D> = match D:',
      '  case Field<infer T>: T',
      '  case Many<infer R>: Array<TreeOf<R>>',
      '  case struct: { [F in keyof D]: TreeOf<D[F]> }',
      'struct Tree:',
      '  label: Field<String>',
      '  children: Many<Tree>',
      'fn makeTree() -> TreeOf<Tree>:',
      '  struct{label: "root", children: [struct{label: "leaf", children: []}]}',
    ];
    const treeFormDecls = [
      ...recursiveDecls,
      'type TreeData = TreeOf<Tree>',
      'fn countNodes(t: TreeData) -> Int:',
      '  let total = 1',
      '  for child in t.children:',
      '    total += countNodes(child)',
      '  total',
      'fn wide() -> TreeData:',
      '  struct{label: "root", children: [struct{label: "a", children: []}, struct{label: "b", children: []}]}',
    ];
    expect(runMain('Int', 'countNodes(wide()) + countNodes(makeTree())', treeFormDecls)).toBe(5);
    expect(compareWrittenTypes('TreeOf<Tree>', 'TreeOf<Many<Tree>>', recursiveDecls).same).toBe(
      false,
    );
    expect(
      compareWrittenTypes('Array<TreeOf<Tree>>', 'TreeOf<Many<Tree>>', recursiveDecls),
    ).toEqual(sameComputedType);

    // Endless expanding reduction: `W<T>` reduces to `W<Array<T>>`
    expect(
      codesOf('type W<T> = match T:', '  case _: W<Array<T>>', 'fn useW(x: W<Int>): ()').length,
    ).toBeGreaterThan(0);

    // Mutual expanding reduction between two type `match` aliases
    expect(
      codesOf(
        'type Ping<T> = match T:',
        '  case _: Pong<(T,)>',
        'type Pong<U> = match U:',
        '  case _: Ping<U>',
        'fn usePing(x: Ping<Int>): ()',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('reports when no case of a type `match` matches at a use site, and refuses inference through a type `match`', () => {
    expect(codesOf(...dataOfDecls, 'fn badUse(x: DataOf<Int>): ()').length).toBeGreaterThan(0);

    expect(
      codesOf(
        ...dataOfDecls,
        'fn inferThroughMatch<D>(x: DataOf<D>) -> Int: 1',
        'fn callIt() -> Int: inferThroughMatch(42)',
      ),
    ).toEqual([checkerDiagnostics.cannotInfer.code]);
  });
});
