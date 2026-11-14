/**
 * What a checker made after an edit analyses again (lifetimes.ts): a caller reads what its callee
 * does through the callee's summary alone, so an edit inside a callee's body that leaves its
 * summary alike analyses the callee again and none of its callers, the closures they make
 * included, while one changing it analyses its callers too. Each finds what a checker made afresh
 * does.
 */

import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import type { Program } from '../../../program/program.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import { checkedApart } from '../../check.test-kit.ts';
import { cycleTemplates } from '../../diagnostics/lifetimes.ts';
import type { ProgramChecker } from '../../wiring/program/program-checker.ts';

const main = idOf('main.ista');

/**
 * A checker of `program` made after `previous`: the functions whose analyses it computed again,
 * by name, the modules whose transients it found again, the codes it reports, and whether a
 * checker made afresh reports the same.
 */
function checkedAfter(previous: ProgramChecker, program: Program) {
  const analysed: string[] = [];
  const transientsFound: unknown[] = [];
  const checker = checkedApart(program, {
    previous,
    observe: (table, key) => {
      if (table === 'lifetime analyses') {
        analysed.push((key as FunctionDeclaration).name.text);
      } else if (table === 'lifetime transients') {
        transientsFound.push(key);
      }
    },
  });
  const diagnostics = checker.diagnosticsOf(main);
  const fresh = checkedApart(program).diagnosticsOf(main);
  return {
    checker,
    analysed,
    transientsFound,
    codes: diagnostics.map(({ code }) => code),
    asFresh: isDeepStrictEqual(diagnostics, fresh),
  };
}

/** A checker of `program` made afresh, its module checked. */
function checkedFirst(program: Program): ProgramChecker {
  const checker = checkedApart(program);
  checker.diagnosticsOf(main);
  return checker;
}

describe('after an edit inside a callee', () => {
  it('keeping its summary, analyses the callee again and none of its callers', () => {
    const textOf = (body: string) =>
      [
        'fn helper(n: Int) -> Int:',
        `  ${body}`,
        'fn suite() -> Array<fn() -> Int>: [',
        '  fn(): helper(1)',
        '  fn(): helper(2)',
        ']',
        'fn caller() -> Int: helper(3)',
        '',
      ].join('\n');
    const first = stdProgramOf({ 'main.ista': textOf('n + 1') });
    const second = stdProgramOf({ 'main.ista': textOf('n + n') }, first);
    expect(checkedAfter(checkedFirst(first), second)).toMatchObject({
      analysed: ['helper'],
      asFresh: true,
    });
  });

  it('keeping its summary and its transients, analyses no async caller, whose futures hold every transient', () => {
    const textOf = (body: string) =>
      [
        'ista fn helper(n: Int) -> Int:',
        `  ${body}`,
        'ista async fn worker() -> Int: 1',
        'ista fn caller() -> Future<Int, "ista">:',
        '  transient let started: Array<Future<Int, "ista">> = []',
        '  _ = helper(3)',
        '  worker()',
        '',
      ].join('\n');
    const first = stdProgramOf({ 'main.ista': textOf('n + 1') });
    const second = stdProgramOf({ 'main.ista': textOf('n + n') }, first);
    expect(checkedAfter(checkedFirst(first), second)).toMatchObject({
      analysed: ['helper'],
      transientsFound: [],
      asFresh: true,
    });
  });

  it('changing what it calls, or with defaults, still analyses only the callee', () => {
    const textOf = (body: string) =>
      [
        'fn id(x: Int) -> Int: x',
        'fn helper(n: Int, extra: Int = 0) -> Int:',
        `  ${body}`,
        'fn caller() -> Int: helper(1) + helper(2, 3)',
        '',
      ].join('\n');
    const first = stdProgramOf({ 'main.ista': textOf('n + extra') });
    const second = stdProgramOf({ 'main.ista': textOf('id(n) + extra') }, first);
    expect(checkedAfter(checkedFirst(first), second)).toMatchObject({
      analysed: ['helper'],
      asFresh: true,
    });
  });

  it('changing its summary, analyses its callers again, and finds what they now do', () => {
    const textOf = (body: string) =>
      [
        'shared struct Lease { n: Int }',
        'fn dispose(self: Lease): ()',
        'shared struct Node { lease: Lease, next: Node? = none }',
        'fn link(x: Node, y: Node):',
        `  ${body}`,
        'fn caller():',
        '  const a = new Node{lease: new Lease{n: 1}}',
        '  link(a, a)',
        '',
      ].join('\n');
    const first = stdProgramOf({ 'main.ista': textOf('()') });
    const second = stdProgramOf({ 'main.ista': textOf('x->next = y') }, first);
    const third = stdProgramOf({ 'main.ista': textOf('()') }, second);
    const linked = checkedAfter(checkedFirst(first), second);
    expect(linked).toMatchObject({
      analysed: ['link', 'caller'],
      codes: [cycleTemplates.cycleCall.code],
      asFresh: true,
    });
    expect(checkedAfter(linked.checker, third)).toMatchObject({ codes: [], asFresh: true });
  });
});
