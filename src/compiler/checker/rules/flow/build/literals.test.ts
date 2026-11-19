/**
 * What a struct literal makes (§5.2, §5.4): its struct, behind a new handle for `new`; or, where
 * it leaves fields to their defaults, the one call of its struct's fields function, given the
 * others, which computes the defaults and makes the value.
 */

import { describe, expect, it } from 'vitest';
import type { FlowFunction } from '../../../surface/flow-ir.ts';
import { subjectFlow } from './flow.test-kit.ts';

/** What `flow` makes, in order, and the calls it makes, with how many arguments. */
function madeIn(flow: FlowFunction): readonly string[] {
  return flow.blocks.flatMap(({ operations }) =>
    operations.flatMap((operation) => {
      if (operation.op === 'make') {
        return [`${operation.made.kind} of ${operation.parts.length}`];
      }
      return operation.op === 'call'
        ? [`call ${operation.call.function.name.text} of ${operation.arguments.length}`]
        : [];
    }),
  );
}

const pair = ['shared struct Pair { first: Int, second: Int = 2 }'];

describe("a struct literal's flow", () => {
  it('makes a new handle of every field it gives', () => {
    const flow = subjectFlow('const p = new Pair{first: 1, second: 3}', pair);
    expect(madeIn(flow)).toEqual(['handle of 2']);
  });

  it('calls its fields function with the fields it gives, leaving the rest to their defaults', () => {
    const flow = subjectFlow('const p = new Pair{first: 1}', pair);
    expect(madeIn(flow)).toEqual(['call Pair of 1']);
  });

  it("makes a comprehension's fields of what each pass gives, copied out before the pass ends", () => {
    const lines = ['const p = Point{x: 1, y: 2}', 'const q = struct{for k, v in ...p: [k]: v}'];
    const flow = subjectFlow(lines.join('\n'));
    const operations = flow.blocks.flatMap((block) => block.operations);
    const made = operations.findLast(
      (operation) => operation.op === 'make' && operation.made.kind === 'struct',
    );
    const sources = (made?.op === 'make' ? made.parts : []).map((part) => {
      const copy = operations.find(
        (operation) => operation.op === 'copy' && operation.into === part,
      );
      return copy?.op === 'copy' ? flow.values[copy.from]?.kind : undefined;
    });
    expect(sources).toEqual(['temporary', 'temporary']);
  });
});
