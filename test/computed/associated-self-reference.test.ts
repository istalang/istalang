/**
 * An associated type can't refer to itself unless its body is a type `match` (§3.1, §3.17):
 * one whose body reaches its own use again through an instantiation, as a mapped struct type over
 * a recursive struct's fields does, is reported where it is written instead of being expanded
 * without end (tracker B32, the form builder's `Group<S>.Data` before it became a type `match`).
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { codesOf } from './computed.test-kit.ts';

const associatedItself = checkerDiagnostics.associatedItself('' as never, '').code;

/** A form model whose `Group<S>.Data` is written with `body`, over a struct holding itself. */
function model(body: readonly string[]): readonly string[] {
  return [
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
    ...body,
    'struct Category:',
    '  name: Field<String>',
    '  children: List<Group<Category>>',
  ];
}

describe('an associated type reaching itself through an instantiation', () => {
  it('is reported where it is written when its body is no type match', () => {
    const declarations = model(['  type Data = { [F in keyof S]: S[F].Data }']);
    expect(codesOf(...declarations, 'fn f(d: Group<Category>.Data) -> Int: 0')).toEqual([
      associatedItself,
    ]);
  });

  it('is a recursive type when its body is a type match', () => {
    const declarations = model([
      '  type Data = match S:',
      '    case _: { [F in keyof S]: S[F].Data }',
    ]);
    expect(
      codesOf(...declarations, 'fn f(d: Group<Category>.Data) -> Int: d.children.length()'),
    ).toEqual([]);
  });
});
