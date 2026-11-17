/**
 * Renumbering a Definition's references (references.ts): every reference of each kind is found, and
 * nothing else changes, so a Definition whose tables are reordered with their references still
 * holds, and reordered back is the one it was.
 */

import { describe, expect, it } from 'vitest';
import { mainDefinition } from '../compiler/compile.test-kit.ts';
import { startToEnd, testRuntime } from '../runtime/runtime.test-kit.ts';
import { encodeDefinition } from './definition.ts';
import { renumbered } from './references.ts';
import { type Definition, tables } from './tables/index.ts';
import { validationIssues } from './validation/index.ts';

const program = mainDefinition(`
import * as runtime from 'runtime'

struct Money:
  cents: Int

enum Shape:
  Dot
  Square(side: Int)

fn area(shape: Shape) -> Int:
  match shape:
    case Dot: 0
    case Square(side): side * side

live async fn main() -> String: await runtime.run(runtime.id()) _main()

ista async fn _main() -> String:
  const shapes: Array<Shape> = [Square(2), Dot]
  const areas = shapes.map(area)
  String(Money{cents: areas[0]}.cents) + " " + Error{message: "m", code: "c"}.trace
`);

/** Each table of `definition` in reverse, its references renumbered to match. */
function reversed(definition: Definition): Definition {
  const last = (count: number) => (id: number) => count - 1 - id;
  const turned = renumbered(tables, definition, {
    function: last(definition.functions.length),
    type: last(definition.types.length),
    constant: last(definition.constants.length),
    module: last(definition.modules.length),
  });
  return {
    ...turned,
    modules: [...turned.modules].reverse(),
    types: [...turned.types].reverse(),
    functions: [...turned.functions].reverse(),
    constants: [...turned.constants].reverse(),
  };
}

describe('renumbered', () => {
  it('gives back the very value when nothing is renumbered', () => {
    expect(renumbered(tables, program, {})).toBe(program);
  });

  it('renumbers every reference: tables reordered with them still hold, run alike, and reorder back', async () => {
    const turned = reversed(program);
    expect(turned).not.toEqual(program);
    expect(validationIssues(turned)).toEqual([]);
    const ran = await startToEnd(testRuntime(), encodeDefinition(turned));
    expect(ran).toEqual(await startToEnd(testRuntime(), encodeDefinition(program)));
    expect(ran).toMatchObject({ kind: 'finished', outcome: expect.stringContaining('4 ') });
    expect(reversed(turned)).toEqual(program);
  });
});
