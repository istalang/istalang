/**
 * A type `match` use is a type only when its reduction ends in one whose values end (§3.1,
 * §3.17): one reaching itself again before any struct type holds it (`case _: A<T>`, through a
 * union or another alias alike) would be itself, as an alias can't be, and one held by a struct
 * type is a recursive type, whose values must end as a recursive struct's do. Each is reported
 * where its use is written, never reaching lowering.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../src/compiler/binder/bind.test-kit.ts';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { diagnosedAt } from '../../src/compiler/compile.test-kit.ts';
import { codesOf, runMain } from './computed.test-kit.ts';

const itself = checkerDiagnostics.aliasCycle('' as never, '').code;
const holdsItself = checkerDiagnostics.recursiveField('' as never, '', '').code;

describe('a type match use reaching itself with no struct type on the way', () => {
  it.each([
    [['type A<T> = match T:', '  case _: A<T>'], 'A<Int>'],
    [['type L<T> = match T:', '  case Int: L<T>', '  case _: T'], 'L<Int>'],
    [['type U<T> = match T:', '  case _: U<T> | Int'], 'U<Int>'],
    [
      [
        'type X1<T> = match T:',
        '  case Int: Y1<T>',
        '  case _: Int',
        'type Y1<T> = match T:',
        '  case _: X1<T>',
      ],
      'X1<Int>',
    ],
  ])('is no type: %j used as %s', (declarations, use) => {
    expect(codesOf(...declarations, `fn f(x: ${use}) -> Int: 1`)).toEqual([itself]);
    expect(codesOf(...declarations, 'fn g():', `  const z: ${use} = 1`)).toEqual([itself]);
  });

  it('names each use on the cycle itself, whichever is asked first', () => {
    const mutual = [
      'type X1<T> = match T:',
      '  case _: Y1<T>',
      'type Y1<T> = match T:',
      '  case _: X1<T>',
    ];
    const messages = (uses: readonly string[]) => {
      const lines = [...mutual, ...uses.map((use, index) => `fn f${index}(x: ${use}) -> Int: 1`)];
      const { diagnostics } = diagnosedAt(
        stdProgramOf({ 'main.ista': lines.join('\n') }),
        'main.ista',
      );
      return diagnostics.map(({ message }) => message).toSorted();
    };
    const firstX = messages(['X1<Int>', 'Y1<Int>']);
    expect(firstX).toHaveLength(2);
    expect(firstX).toEqual(messages(['Y1<Int>', 'X1<Int>']));
    expect(firstX.some((message) => message.includes('X1'))).toBe(true);
    expect(firstX.some((message) => message.includes('Y1'))).toBe(true);
  });

  it('leaves the uses whose cases end alone', async () => {
    const declarations = ['type L<T> = match T:', '  case Int: L<T>', '  case _: T'];
    expect(
      await runMain('String', 'f("s")', [...declarations, 'fn f(x: L<String>) -> L<String>: x']),
    ).toBe('s');
  });
});

describe('a recursive type match use', () => {
  it('whose values would hold themselves is reported as a struct holding itself is', () => {
    const declarations = ['type R<T> = match T:', '  case _: { a: R<T> }'];
    expect(codesOf(...declarations, 'fn f(x: R<Int>) -> Int: 1')).toEqual([holdsItself]);
  });

  it('ending in an optional or a collection checks and runs', async () => {
    const declarations = [
      'type Q<T> = match T:',
      '  case _: { a: Q<T>?, rest: Array<Q<T>> }',
      'fn depth(q: Q<Int>) -> Int:',
      '  match q.a:',
      '    case none: 1',
      '    case _ as inner: 1 + depth(inner)',
    ];
    expect(codesOf(...declarations)).toEqual([]);
    expect(
      await runMain('Int', 'depth(struct{a: struct{a: none, rest: []}, rest: []})', declarations),
    ).toBe(2);
  });
});
