/**
 * Deferred calls as checked (§6.5): what each computes now and what refuses it, how tools read the
 * calls it makes later, through the core each was checked as.
 */

import { describe, expect, it } from 'vitest';
import {
  reportedNothing,
  reportedOnce,
} from '../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { idOf } from '../../program/program.test-kit.ts';
import { programModule } from '../../program/program.ts';
import { declaredFunctions } from '../../syntax/declarations/index.ts';
import type { Call } from '../../syntax/expressions/calls.ts';
import { nodesUnder } from '../../syntax/tree/index.ts';
import { reported } from '../check.test-kit.ts';
import { checkProgram } from '../check.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';

describe('what a deferred call computes now', () => {
  const changing = [
    'struct Counter:',
    '  n: Int',
    'fn bump(self: &Counter):',
    '  self.n += 1',
    'fn grow(n: &Int):',
    '  n += 1',
    'fn run(f: fn() -> Unit):',
    '  f()',
    'live fn liveThing(): ()',
    'fn hold(f: live fn() -> Unit): ()',
  ];

  it.each([
    ['a receiver its method takes by &self', '  let counter = Counter{n: 0}\n  run counter.bump()'],
    ['an argument passed by &', '  let n = 1\n  run grow(&n)'],
  ])('leaves the variable %s would change unchanged, the call refused', (_case, body) => {
    const text = [...changing, 'fn f():', body].join('\n');
    expect(reported(text).codes).toEqual([
      checkerDiagnostics.letNeverReassigned.code,
      checkerDiagnostics.deferredReference.code,
    ]);
  });

  it('leaves the function around it relying on no kind for the call it defers', () => {
    const text = [
      ...changing,
      'live fn f():',
      '  const deferring = fn(): hold liveThing()',
      '  const plain: fn() -> Unit = deferring',
    ].join('\n');
    expect(reported(text)).toEqual(reportedNothing);
  });
});

describe('a deferred call as tools read it', () => {
  it('answers for each call it makes later, however deep, by the call it was checked as', () => {
    const text = [
      'fn run(f: fn() -> Int) -> Int:',
      '  f()',
      'fn d(n: Int) -> Int:',
      '  n',
      'fn f() -> Int: run run run d(1)',
    ].join('\n');
    const checked = stdProgramOf({ 'main.ista': text });
    const { tree } = programModule(checked, idOf('main.ista'));
    const declaration = declaredFunctions(tree.root).find(({ name }) => name.text === 'f');
    const body = declaration === undefined ? undefined : checkProgram(checked).bodyOf(declaration);
    const callOfD = nodesUnder(tree, tree.root).find(
      (node): node is Call =>
        node.kind === 'Call' && node.callee.kind === 'Identifier' && node.callee.text === 'd',
    );
    expect(
      callOfD === undefined ? undefined : body?.resolved.get(callOfD)?.function.name.text,
    ).toBe('d');
  });
});

describe("a deferred call's field value", () => {
  it('is read now, through an optional chain of several links, the call made later calling it', () => {
    const text = [
      'struct Box:',
      '  f: fn(Int) -> Int',
      'struct Outer:',
      '  box: Box',
      'fn optional(f: fn() -> Int?) -> Int?:',
      '  f()',
      'fn g(outer: Outer?) -> Int?: optional outer?.box.f(5)',
    ].join('\n');
    const checked = stdProgramOf({ 'main.ista': text });
    const { tree } = programModule(checked, idOf('main.ista'));
    const declaration = declaredFunctions(tree.root).find(({ name }) => name.text === 'g');
    const body = declaration === undefined ? undefined : checkProgram(checked).bodyOf(declaration);
    const callOfF = nodesUnder(tree, tree.root).find(
      (node): node is Call => node.kind === 'Call' && node.callee.kind === 'MemberAccess',
    );
    const made = callOfF === undefined ? undefined : body?.coreOf(callOfF);
    expect(made?.kind === 'Call' ? [made.callee.kind, made.isOptional] : made).toEqual([
      'Identifier',
      true,
    ]);
  });
});

describe("a deferred call's taker", () => {
  it("is refused a constant by '&' as any call is, not as what its call computes now", () => {
    const text = [
      'struct Counter:',
      '  n: Int',
      'fn takes(c: &Counter, f: fn() -> Unit): ()',
      'fn nothing(): ()',
      'fn f():',
      '  const counter = Counter{n: 0}',
      '  takes(&counter) nothing()',
    ].join('\n');
    expect(reported(text).codes).toEqual([checkerDiagnostics.constantChanged.code]);
  });
});

describe('a deferred call of a variant without fields', () => {
  it('gives a function making its value, warned of as the value written as a call', () => {
    const text = [
      'enum State:',
      '  Idle',
      '  Busy(n: Int)',
      'fn keep(f: fn() -> State) -> State:',
      '  f()',
      'fn f() -> State: keep State.Idle()',
    ].join('\n');
    expect(reported(text)).toEqual(
      reportedOnce(checkerDiagnostics.fieldlessCalled.code, 'State.Idle()'),
    );
  });
});
