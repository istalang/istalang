/**
 * Where a body's flow releases its variables (§3.4, §7): a block's at its end and where an exit
 * leaves it, a `hold(name)`'s once, where the scope it names ends, however it ends.
 */

import { describe, expect, it } from 'vitest';
import type { FlowFunction } from '../../../surface/flow-ir.ts';
import { subjectFlow } from './flow.test-kit.ts';

/** How many times `flow` releases the variable named `name`, and by what. */
function releasesOf(flow: FlowFunction, name: string): readonly string[] {
  return flow.blocks.flatMap(({ operations }) =>
    operations.flatMap((operation) =>
      operation.op === 'release' &&
      operation.values.some((value) => {
        const found = flow.values[value];
        return found?.kind === 'variable' && found.entity.name.text === name;
      })
        ? [operation.reason]
        : [],
    ),
  );
}

describe("a body's flow", () => {
  it("releases a block's variable once, at its end", () => {
    expect(releasesOf(subjectFlow('if c:\n  const t = "a"'), 't')).toEqual(['scope']);
  });

  it('releases a loop pass variable where `break` and `continue` leave it, and at its end', () => {
    const flow = subjectFlow(
      [
        'for i in 0..3:',
        '  const t = "a"',
        '  if c:',
        '    break',
        '  if n > 1:',
        '    continue',
      ].join('\n'),
    );
    expect(releasesOf(flow, 't')).toEqual(['scope', 'scope', 'scope']);
  });

  it("releases a `hold(name)`'s variable once, where the block it names ends", () => {
    const flow = subjectFlow(
      [
        'outer:',
        '  for i in 0..3:',
        '    hold(outer) const h = "a"',
        '    if c:',
        '      break',
      ].join('\n'),
    );
    expect(releasesOf(flow, 'h')).toEqual(['scope']);
  });

  it("keeps a `hold(name)`'s variable over the passes of the loop it names, `continue` too", () => {
    const flow = subjectFlow(
      [
        'outer: for i in 0..3:',
        '  for j in 0..3:',
        '    hold(outer) const h = "a"',
        '    if c:',
        '      break outer',
        '    if n > 1:',
        '      continue outer',
      ].join('\n'),
    );
    expect(releasesOf(flow, 'h')).toEqual(['scope']);
  });

  it('releases a dropped variable by its `drop`', () => {
    expect(releasesOf(subjectFlow('const t = "a"\ndrop t'), 't')).toEqual(['drop', 'scope']);
  });
});
