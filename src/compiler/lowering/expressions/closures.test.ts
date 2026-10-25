/**
 * Lowering closures (§3.14; docs/arch/definition.md, "Frames"): a nested function is an entry of
 * its own, laid out with its captures after its parameters; a captured `let` is a cell on both
 * sides; a named one answers to its name through the closure it runs; and blocks release their
 * variables on every exit, so a loop body's are fresh each time.
 */

import { describe, expect, it } from 'vitest';
import type { Definition } from '../../../definition/definition.ts';
import type { CodeFunction } from '../../../definition/functions.ts';
import { preludeProgramOf } from '../../binder/bind.test-kit.ts';
import { compiledDefinition } from '../../compile.test-kit.ts';

function compiled(lines: readonly string[]): Definition {
  return compiledDefinition(preludeProgramOf({ main: lines.join('\n') }), 'main');
}

function entryNamed(definition: Definition, name: string): CodeFunction {
  const entry = definition.functions.find((each) => each.name === name);
  if (entry?.kind !== 'code') {
    throw new Error(`No code entry '${name}' in ${definition.functions.map((each) => each.name)}.`);
  }
  return entry;
}

const counter = [
  'fn makeCounter(start: int) -> fn() -> int:',
  '  let count = start',
  '  fn next() -> int:',
  '    count += 1',
  '    count',
  '  next',
  'async fn main(): makeCounter(0)()',
];

describe('lowering closures', () => {
  it('makes a nested function an entry carrying its captures, a captured let a cell on both sides', () => {
    const definition = compiled(counter);
    const outer = entryNamed(definition, 'main.makeCounter');
    const next = entryNamed(definition, 'main.makeCounter.next');
    expect(next.captures).toBe(1);
    expect(next.cells.map((cell) => cell.register)).toContain(next.parameters.length);
    const closure = outer.instructions.find((instruction) => instruction.kind === 'closure');
    expect(closure?.kind === 'closure' && closure.captures).toHaveLength(1);
    const captured = closure?.kind === 'closure' ? closure.captures[0] : undefined;
    expect(outer.cells.map((cell) => cell.register)).toContain(captured);
  });

  it('gives a named nested function its own closure, and a top-level function value none', () => {
    const definition = compiled([
      'fn inc(n: int) -> int: n + 1',
      'fn twice(f: fn(int) -> int, x: int) -> int: f(f(x))',
      'fn down() -> int:',
      '  fn count(n: int) -> int: if n == 0: 0 else: count(n - 1)',
      '  count(3) + twice(inc, 1)',
      'async fn main(): down()',
    ]);
    const count = entryNamed(definition, 'main.down.count');
    expect(count.instructions.some((instruction) => instruction.kind === 'currentClosure')).toBe(
      true,
    );
    const down = entryNamed(definition, 'main.down');
    const values = down.instructions.filter((instruction) => instruction.kind === 'closure');
    const captures = values.map((each) => (each.kind === 'closure' ? each.captures : undefined));
    expect(captures).toEqual([[], []]);
  });

  it("releases a loop body's variables at its end and on leaving it, but not a function body's", () => {
    const definition = compiled([
      'fn loop() -> int:',
      '  let total = 0',
      '  while total < 3:',
      '    let step = 1',
      '    if total > 1:',
      '      break',
      '    total += step',
      '  total',
      'async fn main(): loop()',
    ]);
    const releases = entryNamed(definition, 'main.loop').instructions.filter(
      (instruction) => instruction.kind === 'release',
    );
    const released = releases.map((each) => (each.kind === 'release' ? each.registers : []));
    // `break` and the body's end each release `step`; `total`, the function's own, never is.
    expect(released).toHaveLength(2);
    expect(released[0]).toEqual(released[1]);
    expect(released[0]).toHaveLength(1);
  });
});
