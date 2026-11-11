/**
 * Lowering closures (§3.14; docs/arch/definition.md, "Frames"): a nested function is an entry of
 * its own, laid out with its captures after its parameters; a captured `let` is a cell on both
 * sides; a named one answers to its name through the closure it runs; and blocks release their
 * variables on every exit, so a loop body's are fresh each time.
 */

import { describe, expect, it } from 'vitest';
import type { Definition } from '../../../../definition/definition.ts';
import type { CodeFunction } from '../../../../definition/tables/functions.ts';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { compiledDefinition } from '../../../compile.test-kit.ts';

function compiled(lines: readonly string[]): Definition {
  return compiledDefinition(stdProgramOf({ main: lines.join('\n') }), 'main');
}

function entryNamed(definition: Definition, name: string): CodeFunction {
  const entry = definition.functions.find((each) => each.name === name);
  if (entry?.kind !== 'code') {
    throw new Error(`No code entry '${name}' in ${definition.functions.map((each) => each.name)}.`);
  }
  return entry;
}

const counter = [
  'fn makeCounter(start: Int) -> fn() -> Int:',
  '  let count = start',
  '  fn next() -> Int:',
  '    count += 1',
  '    count',
  '  next',
  "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): makeCounter(0)()",
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
      'fn inc(n: Int) -> Int: n + 1',
      'fn twice(f: fn(Int) -> Int, x: Int) -> Int: f(f(x))',
      'fn down() -> Int:',
      '  fn count(n: Int) -> Int: if n == 0: 0 else: count(n - 1)',
      '  count(3) + twice(inc, 1)',
      "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): down()",
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
      'fn loop() -> Int:',
      '  let total = 0',
      '  while total < 3:',
      '    let step = 1',
      '    if total > 1:',
      '      break',
      '    total += step',
      '  total',
      "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): loop()",
    ]);
    const { instructions } = entryNamed(definition, 'main.loop');
    const [total, step] = instructions.flatMap((each) => (each.kind === 'move' ? [each.dst] : []));
    const releasing = (register: number | undefined) =>
      instructions.filter(
        (each) =>
          each.kind === 'release' && register !== undefined && each.registers.includes(register),
      );
    // `break` and the body's end each release `step`; `total`, the function's own, never is.
    expect(releasing(step)).toHaveLength(2);
    expect(releasing(total)).toHaveLength(0);
  });
});
