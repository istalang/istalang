/**
 * Where a place is written (§7.3, §10.2): a part of an element is written into the element as it
 * stands when the write happens, read anew then, so what changed another part meanwhile stays.
 */

import { describe, expect, it } from 'vitest';
import type { FlowFunction } from '../../../surface/flow-ir.ts';
import { subjectFlow } from './flow.test-kit.ts';

/** The functions `flow` calls, by name, in block order. */
function calledIn(flow: FlowFunction): readonly string[] {
  return flow.blocks.flatMap(({ operations }) =>
    operations.flatMap((operation) =>
      operation.op === 'call' ? [operation.call.function.name.text] : [],
    ),
  );
}

describe("a place's flow", () => {
  it('reads an element where entered, and anew where a part of it is written', () => {
    const flow = subjectFlow('let xs = [Point{x: 0, y: 0}]\nxs[0].x += 1');
    const called = calledIn(flow).filter((name) => name === 'index' || name === 'setIndex');
    expect(called).toEqual(['index', 'index', 'setIndex']);
  });
});
