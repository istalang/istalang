/**
 * Where a flow's blocks go in the code (checker surface/flow-ir.ts): their order, and the passes of
 * the field loops each is written in (§4).
 *
 * - Only blocks a path reaches are written, in reverse postorder over each block's successors
 *   taken last first: a branch's paths in their order, where they meet after them, as source reads.
 * - A field loop's top goes to its passes, one per field of the struct an instantiation made known,
 *   in field order (checker instantiation.ts), each run once. A block is written in the pass whose
 *   start dominates it; going to the top from a pass goes on to the next pass, or past the loop
 *   after the last. A pass visiting no field is never written.
 */

import { addToGroup } from '../../../foundation/structures/groups.ts';
import {
  type BlockId,
  type FlowBlock,
  type FlowFunction,
  successorsOf,
} from '../../checker/surface/flow-ir.ts';
import type { FieldLoopHeader } from '../../syntax/expressions/index.ts';
import type { FieldPassStep } from '../tables/instances.ts';

/** A field loop's pass a block is written in: its field, its loop's top, and what follows it. */
export interface PassVisit extends FieldPassStep {
  readonly top: BlockId;
  readonly next: BlockId;
}

export interface FlowLayout {
  readonly order: readonly BlockId[];
  /** The passes `block` is written in, outermost first. */
  readonly passesOf: (block: BlockId) => readonly PassVisit[];
  /** Where the field loop whose top is `top` goes first: its first pass, or past it. */
  readonly firstOf: (top: BlockId) => BlockId;
}

/** Where `flow`'s blocks go. */
export function layoutOf(flow: FlowFunction): FlowLayout {
  const order = postorder(flow).toReversed();
  const laid: Laid = { passes: new Map(), firsts: new Map(), unwritten: new Set() };
  const reached = reachedFrom(flow, 0);
  const dominatedBy = (start: BlockId) => {
    const avoiding = reachedFrom(flow, 0, start);
    return [...reached].filter((block) => !avoiding.has(block));
  };
  for (const top of order) {
    const { exit } = flow.blocks[top] as FlowBlock;
    if (exit.kind === 'branch' && exit.test.kind === 'fieldPass') {
      const { header, fields } = exit.test;
      layPasses(laid, { top, header, fields, to: exit.to }, dominatedBy);
    }
  }
  return {
    order: order.filter((block) => !laid.unwritten.has(block)),
    passesOf: (block) => laid.passes.get(block) ?? [],
    firstOf: (top) => laid.firsts.get(top) ?? top,
  };
}

/** The passes each block is in, where each field loop goes first, and what is never written. */
interface Laid {
  readonly passes: Map<BlockId, PassVisit[]>;
  readonly firsts: Map<BlockId, BlockId>;
  readonly unwritten: Set<BlockId>;
}

/**
 * Lays out the passes of the field loop whose top is `top`, going past it then to each pass's
 * start (`to`), each visiting the field `fields` names, in their order; each block a pass's start
 * dominates is in that pass, and one visiting no field is never written.
 */
function layPasses(
  laid: Laid,
  loop: {
    readonly top: BlockId;
    readonly header: FieldLoopHeader;
    readonly fields: readonly (string | undefined)[];
    readonly to: readonly BlockId[];
  },
  dominatedBy: (start: BlockId) => readonly BlockId[],
): void {
  const { top, header, fields } = loop;
  const [past, ...starts] = loop.to as [BlockId, ...BlockId[]];
  const runs = starts.filter((_, index) => fields[index] !== undefined);
  laid.firsts.set(top, runs[0] ?? past);
  for (const [index, start] of starts.entries()) {
    const field = fields[index];
    const next = runs[runs.indexOf(start) + 1] ?? past;
    for (const block of dominatedBy(start)) {
      if (field === undefined) {
        laid.unwritten.add(block);
      } else {
        addToGroup(laid.passes, block, { header, field, top, next });
      }
    }
  }
}

/** The blocks a path from `from` reaches, never through `avoided`. */
function reachedFrom(flow: FlowFunction, from: BlockId, avoided?: BlockId): Set<BlockId> {
  const reached = new Set<BlockId>();
  const pending = [from];
  for (let block = pending.pop(); block !== undefined; block = pending.pop()) {
    if (block !== avoided && !reached.has(block)) {
      reached.add(block);
      pending.push(...successorsOf((flow.blocks[block] as FlowBlock).exit));
    }
  }
  return reached;
}

/** The blocks a path reaches, each after every block it goes on to first, successors last first. */
function postorder(flow: FlowFunction): readonly BlockId[] {
  const done: BlockId[] = [];
  const seen = new Set<BlockId>([0]);
  const stack: { readonly block: BlockId; readonly pending: BlockId[] }[] = [
    { block: 0, pending: [...successorsOf((flow.blocks[0] as FlowBlock).exit)] },
  ];
  for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
    const next = top.pending.pop();
    if (next === undefined) {
      done.push(top.block);
      stack.pop();
    } else if (!seen.has(next)) {
      seen.add(next);
      stack.push({
        block: next,
        pending: [...successorsOf((flow.blocks[next] as FlowBlock).exit)],
      });
    }
  }
  return done;
}
