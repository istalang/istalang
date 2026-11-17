/**
 * How a flow uses its values, found once per flow (writer.ts, held-reads.ts): where each is read,
 * how often each is written, and the scope each value a `keep` keeps is kept until.
 *
 * - A value read once is moved where it is read; one read twice, or a variable, is copied.
 * - A release or a keep reads nothing: it ends or extends a value's life, and its operands are
 *   counted by what reads them.
 * - An exit reads what it tests and what it returns.
 */

import { memo } from '../../../foundation/structures/memo.ts';
import type {
  BlockId,
  Exit,
  FlowFunction,
  Operation,
  ValueId,
} from '../../checker/surface/flow-ir.ts';
import { valuesReadBy } from '../../checker/surface/flow-ir.ts';
import type { LabelledScope } from '../../syntax/statements/index.ts';

/** An operation of a flow, or its block's exit (`index` past the last operation). */
export interface FlowPosition {
  readonly block: BlockId;
  readonly index: number;
}

export interface FlowUses {
  /** Where each value is read, an operation or an exit, once per read. */
  readonly reads: ReadonlyMap<ValueId, readonly FlowPosition[]>;
  readonly writes: ReadonlyMap<ValueId, number>;
  /** Each value a `keep` keeps, and the scope it is kept until. */
  readonly kept: ReadonlyMap<ValueId, LabelledScope | 'function'>;
}

const usesOfFlows = new WeakMap<FlowFunction, FlowUses>();

/** How `flow` uses its values. */
export function usesOf(flow: FlowFunction): FlowUses {
  return memo(usesOfFlows, flow, () => {
    const uses: Counting = { reads: new Map(), writes: new Map(), kept: new Map() };
    for (const [block, { operations, exit }] of flow.blocks.entries()) {
      for (const [index, operation] of operations.entries()) {
        countUses(uses, operation, { block, index });
      }
      for (const value of exitReads(exit)) {
        readAt(uses.reads, value, { block, index: operations.length });
      }
    }
    return uses;
  });
}

/** The uses being found, which `FlowUses` reads once found. */
interface Counting {
  readonly reads: Map<ValueId, FlowPosition[]>;
  readonly writes: Map<ValueId, number>;
  readonly kept: Map<ValueId, LabelledScope | 'function'>;
}

/** Counts what `operation`, at `at`, reads, writes and keeps. */
function countUses(
  { reads, writes, kept }: Counting,
  operation: Operation,
  at: FlowPosition,
): void {
  if (operation.op === 'keep') {
    for (const value of operation.values) {
      kept.set(value, operation.until);
    }
  } else if (operation.op !== 'release') {
    for (const value of valuesReadBy(operation)) {
      readAt(reads, value, at);
    }
  }
  if ('into' in operation) {
    writes.set(operation.into, (writes.get(operation.into) ?? 0) + 1);
  }
}

function readAt(reads: Map<ValueId, FlowPosition[]>, value: ValueId, at: FlowPosition): void {
  memo(reads, value, () => []).push(at);
}

/** What `exit` reads: the value its branch tests, the value it returns. */
function exitReads(exit: Exit): readonly ValueId[] {
  const tested = exit.kind === 'branch' && 'value' in exit.test ? [exit.test.value] : [];
  const returned = exit.kind === 'return' && exit.value !== undefined ? [exit.value] : [];
  return [...tested, ...returned];
}
