/**
 * An associated type can't refer to itself unless its body is a type `match` (§5.2, §4.6):
 * one whose body reaches its own use again through an instantiation, as a mapped struct type over
 * a recursive struct's fields does, is the error type wherever it is reached, reported where an
 * instantiation reaching it is written, a written type's or one a call infers, instead of being
 * expanded without end (tracker B32, the form builder's `Group<S>.Data` before it became a type
 * `match`).
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../src/compiler/binder/bind.test-kit.ts';
import { reported } from '../../src/compiler/checker/check.test-kit.ts';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { diagnosedAt } from '../../src/compiler/compile.test-kit.ts';
import { codesOf } from '../written-types.test-kit.ts';

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

const mappedModel = model(['  type Data = { [F in keyof S]: S[F].Data }']);

/** A generic function giving a group's `Data`, so a call infers the instantiation reaching it. */
const dataOf = [
  'fn dataOf<S is struct { [_] is Node }>(g: Group<S>) -> Group<S>.Data:',
  '  panic("never")',
];

/** The codes checking `lines` reports, and their messages. */
function reportedMessages(...lines: readonly string[]) {
  const { diagnostics } = diagnosedAt(stdProgramOf({ main: lines.join('\n') }), 'main');
  return {
    codes: diagnostics.map((diagnostic) => diagnostic.code),
    messages: diagnostics.map((diagnostic) => diagnostic.message),
  };
}

/** The distinct codes checking `lines` reports, and the spans it reports them at. */
function reportedFor(...lines: readonly string[]) {
  const { codes, spanTexts } = reported(lines.join('\n'));
  return { codes: [...new Set(codes)], spans: spanTexts };
}

describe('an associated type reaching itself through an instantiation', () => {
  it('is reported where the instantiations reaching it are written', () => {
    const { codes, spans } = reportedFor(...mappedModel, 'fn f(d: Group<Category>.Data) -> Int: 0');
    expect(codes).toEqual([associatedItself]);
    expect(spans).toContain('List<Group<Category>>');
    expect(spans.filter((span) => span === 'Group<Category>')).toHaveLength(2);
  });

  it('is reported where a call inferring the instantiation is written', () => {
    const { codes, spans } = reportedFor(
      ...mappedModel,
      ...dataOf,
      'fn main() -> Int:',
      '  const g = Group{fields: Category{name: Field{value: "a"}, children: List{rows: []}}}',
      '  dataOf(g).children.length()',
    );
    expect(codes).toEqual([associatedItself]);
    expect(spans).toContain('dataOf(g)');
  });

  it('is one error type however it is reached, which reports nothing more', () => {
    const { codes } = reportedFor(
      ...mappedModel,
      ...dataOf,
      'fn h(g: Group<Category>) -> Group<Category>.Data:',
      '  dataOf(g)',
      'fn k(g: Group<Category>) -> Array<Group<Category>.Data>:',
      '  [dataOf(g)]',
    );
    expect(codes).toEqual([associatedItself]);
  });

  it('is a recursive type when its body is a type match', () => {
    const declarations = model([
      '  type Data = match S:',
      '    case _: { [F in keyof S]: S[F].Data }',
    ]);
    expect(
      codesOf(
        ...declarations,
        ...dataOf,
        'fn f(d: Group<Category>.Data) -> Int: d.children.length()',
        'fn h(g: Group<Category>) -> Group<Category>.Data:',
        '  dataOf(g)',
      ),
    ).toEqual([]);
  });
});

describe('an associated type `match` naming no type', () => {
  it.each([
    ['on a type with no parameters', 'struct Bad:', 'Bad.Data', "'Bad.Data'"],
    ['on a generic type', 'struct Bad<T>:', 'Bad<Int>.Data', "'Bad<Int>.Data'"],
  ])('is reported %s, spelled as written', (_case, owner, written, spelled) => {
    const { codes, messages } = reportedMessages(
      owner,
      '  x: Int',
      '  type Data = match Int:',
      `    case Int: ${written}`,
      `fn f(x: ${written}) -> Int: 0`,
    );
    expect(codes).toContain(checkerDiagnostics.aliasCycle('' as never, '').code);
    expect(messages.every((message) => message.includes(spelled))).toBe(true);
  });
});
