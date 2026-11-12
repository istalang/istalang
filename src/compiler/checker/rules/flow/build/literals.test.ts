/**
 * What a struct literal makes (§3.1, §3.18): its struct, behind a new handle for `new`, the fields
 * it leaves to their defaults computed first, so the value made is in the flow however it is built.
 */

import { describe, expect, it } from 'vitest';
import type { FlowFunction } from '../flow-ir.ts';
import { subjectFlow } from './flow.test-kit.ts';

const aCall = /^call /u;

/** What `flow` makes, in order, and the calls it makes of defaults. */
function madeIn(flow: FlowFunction): readonly string[] {
  return flow.blocks.flatMap(({ operations }) =>
    operations.flatMap((operation) => {
      if (operation.op === 'make') {
        return [`${operation.made.kind} of ${operation.parts.length}`];
      }
      return operation.op === 'call' ? [`call ${operation.call.function.name.text}`] : [];
    }),
  );
}

describe("a struct literal's flow", () => {
  it('makes a new handle of every field, a default computed first', () => {
    const flow = subjectFlow('const p = new Pair{first: 1}', [
      'shared struct Pair { first: Int, second: Int = 2 }',
    ]);
    expect(madeIn(flow)).toEqual([expect.stringMatching(aCall), 'handle of 2']);
  });
});
