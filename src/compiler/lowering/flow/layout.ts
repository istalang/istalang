/**
 * Where a flow's blocks go in the code (checker surface/flow-ir.ts): their order, and the passes of
 * the field loops each is written in (§4).
 *
 * - A field loop's top goes to its passes, one per field of the struct an instantiation made known,
 *   in field order (checker instantiation.ts), each run once. A block is written in the pass whose
 *   start dominates it; going to the top from a pass goes on to the next pass, or past the loop
 *   after the last. A pass visiting no field is never gone to.
 * - Only blocks a path reaches, going as passes go, are written, in reverse postorder over each
 *   block's successors taken last first: a branch's paths in their order, where they meet after
 *   them, as source reads; a field loop's passes in their order, then what follows the loop.
 */

import { addToGroup } from '../../../foundation/structures/groups.ts';
import { nodesReachedFrom } from '../../../foundation/structures/reachable.ts';
import {
  type BlockId,
  type FlowBlock,
  type FlowFunction,
  successorsOf,
} from '../../checker/surface/flow-ir.ts';
import type { FieldLoopHeader } from '../../syntax/expressions/index.ts';
import type { FieldPassStep } from '../tables/instances.ts';

/** A field loop's pass a block is written in: its field, its loop's top, and what follows it. */
interface PassVisit extends FieldPassStep {
  readonly top: BlockId;
  readonly next: BlockId;
}

export interface FlowLayout {
  readonly order: readonly BlockId[];
  /** The passes `block` is written in, outermost first. */
  readonly passesOf: (block: BlockId) => readonly PassVisit[];
  /** Where the field loop whose top is `top` goes first: its first pass, or past it. */
  readonly firstOf: (top: BlockId) => BlockId;
  /** Where going from `from` to `to` goes: from a pass to its loop's top, on to the next pass. */
  readonly towards: (from: BlockId, to: BlockId) => BlockId;
}

/** Where `flow`'s blocks go. */
export function layoutOf(flow: FlowFunction): FlowLayout {
  const exitOf = (block: BlockId) => (flow.blocks[block] as FlowBlock).exit;
  const laid: Laid = { passes: new Map(), firsts: new Map() };
  const reached = reachedFrom(flow, 0);
  const dominatedBy = (start: BlockId) => {
    const avoiding = reachedFrom(flow, 0, start);
    return [...reached].filter((block) => !avoiding.has(block));
  };
  // Outer loops' tops come first, so a block's passes are listed outermost first.
  for (const top of postorder((block) => successorsOf(exitOf(block))).toReversed()) {
    const exit = exitOf(top);
    if (exit.kind === 'branch' && exit.test.kind === 'fieldPass') {
      const { header, fields } = exit.test;
      layPasses(laid, { top, header, fields, to: exit.to }, dominatedBy);
    }
  }
  const passesOf = (block: BlockId) => laid.passes.get(block) ?? [];
  const firstOf = (top: BlockId) => laid.firsts.get(top) ?? top;
  const towards = (from: BlockId, to: BlockId) =>
    passesOf(from).find(({ top }) => top === to)?.next ?? to;
  const goesTo = (block: BlockId) => {
    const exit = exitOf(block);
    return exit.kind === 'branch' && exit.test.kind === 'fieldPass'
      ? [firstOf(block)]
      : successorsOf(exit).map((to) => towards(block, to));
  };
  return { order: postorder(goesTo).toReversed(), passesOf, firstOf, towards };
}

/** The passes each block is in, and where each field loop goes first. */
interface Laid {
  readonly passes: Map<BlockId, PassVisit[]>;
  readonly firsts: Map<BlockId, BlockId>;
}

/**
 * Lays out the passes of the field loop whose top is `top`, going past it then to each pass's
 * start (`to`), each visiting the field `fields` names, in their order; each block a pass's start
 * dominates is in that pass, and one visiting no field is skipped.
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
    if (field !== undefined) {
      for (const block of dominatedBy(start)) {
        addToGroup(laid.passes, block, { header, field, top, next });
      }
    }
  }
}

/** The blocks a path from `from` reaches, never through `avoided`. */
function reachedFrom(flow: FlowFunction, from: BlockId, avoided?: BlockId): Set<BlockId> {
  const exitOf = (block: BlockId) => (flow.blocks[block] as FlowBlock).exit;
  return nodesReachedFrom(from === avoided ? [] : [from], (block) =>
    successorsOf(exitOf(block)).filter((each) => each !== avoided),
  );
}

/**
 * The blocks a path from the first reaches, going on as `goesTo` says, each after every block it
 * goes on to first, successors last first.
 */
function postorder(goesTo: (block: BlockId) => readonly BlockId[]): readonly BlockId[] {
  const done: BlockId[] = [];
  const seen = new Set<BlockId>([0]);
  const stack: { readonly block: BlockId; readonly pending: BlockId[] }[] = [
    { block: 0, pending: [...goesTo(0)] },
  ];
  for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
    const next = top.pending.pop();
    if (next === undefined) {
      done.push(top.block);
      stack.pop();
    } else if (!seen.has(next)) {
      seen.add(next);
      stack.push({ block: next, pending: [...goesTo(next)] });
    }
  }
  return done;
}
