/**
 * A recursive alias's entry stands for the structural type it unfolds to (docs/arch/definition.md,
 * "Types and locations"): its body is that tuple or function, never the alias again, which folding
 * the unfolded type back would give.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { compiledDefinition, wholeProgramTimeout } from '../../compile.test-kit.ts';

const main = [
  "import * as runtime from 'runtime'",
  'type Chain = (Int, Chain?)',
  'type Machine = fn(Int) -> Machine',
  'fn first(c: Chain?) -> Int?: c?.0',
  'fn step(m: Machine?) -> Machine?: m?.(1)',
  'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
  '  const m = step(none)',
  '  return first((7, none)) ?? 0',
].join('\n');

describe("a recursive alias's entry", () => {
  it(
    'unfolds to its tuple or function',
    () => {
      const { types } = compiledDefinition(stdProgramOf({ 'main.ista': main }), 'main.ista');
      const bodies = types.flatMap((entry) => (entry.kind === 'alias' ? [entry.type.kind] : []));
      expect(bodies).toEqual(expect.arrayContaining(['tuple', 'function']));
      expect(bodies.every((kind) => kind === 'tuple' || kind === 'function')).toBe(true);
    },
    wholeProgramTimeout,
  );
});
