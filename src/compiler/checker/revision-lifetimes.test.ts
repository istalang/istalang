/**
 * A checker made after an earlier one keeps nothing of revisions before that one: a body it takes
 * over holds only what checking recorded, never the checker that checked it, so an editor checking
 * every edit after the last one keeps two revisions, not one per edit, whatever the body's kind and
 * whoever read it: diagnosing or lowering.
 */

import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { compileProgram } from '../compile.ts';
import { idOf } from '../program/program.test-kit.ts';
import type { Program } from '../program/program.ts';
import { checkProgram } from './check.ts';

setFlagsFromString('--expose_gc');
const collectGarbage = runInNewContext('gc') as () => void;

/**
 * A program whose bodies, checked once, every later revision takes over: one of each kind of body
 * and of what a body records, a generic function instantiated at a concrete type, a default's and a
 * constant's bodies, a field loop's passes, a loop, a match, a local function and a lambda.
 */
const unchanged = [
  'const offset = 3',
  'struct Pair { left: Int, right: Int }',
  'fn first<T>(items: Array<T>) -> T: items[0]',
  'fn scaled(n: Int, by: Int = 2) -> Int: n * by',
  'fn total(p: Pair) -> Int:',
  '  let sum = 0',
  '  for key, value in ...p:',
  '    sum += value',
  '  sum',
  'fn counted(items: Array<Int>) -> Int:',
  '  let n = 0',
  '  for item in items:',
  '    n += item',
  '  n',
  'fn classified(n: Int) -> Int:',
  '  match n:',
  '    case 0: 10',
  '    case _: n',
  'fn composed(n: Int) -> Int:',
  '  fn twice(x: Int) -> Int: x * 2',
  '  const add = fn(x: Int) -> Int: x + offset',
  '  add(twice(n))',
  'live async fn main() -> Int:',
  '  const p = Pair{left: 1, right: 2}',
  '  first([total(p), counted([1, 2]), scaled(composed(1)), classified(0)]) + edited()',
].join('\n');

/** Revision `n` of the program: the same bodies, and a function that differs in each. */
function revision(n: number, previous: Program | undefined): Program {
  return stdProgramOf({ main: `${unchanged}\nfn edited() -> Int: ${n}\n` }, previous);
}

/**
 * Checks `program` after `previous` as an editor does, every body of its main module asked for, and
 * compiles it, so lowering reads every body it takes over too; how the compile ended.
 */
function checkedAfter(program: Program, previous: Program | undefined): string {
  checkProgram(program, { previous }).diagnosticsOf(idOf('main'));
  return compileProgram(program, idOf('main')).kind;
}

describe('a checker made after an earlier one', () => {
  it('lets go of revisions before that one, though it took their bodies over', async () => {
    let previous = revision(0, undefined);
    expect(checkedAfter(previous, undefined)).toBe('compiled');
    const first = new WeakRef(checkProgram(previous));
    for (let n = 1; n <= 3; n += 1) {
      const next = revision(n, previous);
      expect(checkedAfter(next, previous)).toBe('compiled');
      previous = next;
    }
    // A WeakRef keeps what it refers to until the job that made it ends.
    await new Promise((resolve) => setImmediate(resolve));
    collectGarbage();
    expect(first.deref()).toBeUndefined();
  });
});
