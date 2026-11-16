/**
 * How a flow uses its values, counted once before it is written (writer.ts): how often each is
 * read and written, and the scope each value a `keep` keeps is kept until.
 *
 * - A value read once is moved where it is read; one read twice, or a variable, is copied.
 * - A release or a keep reads nothing: it ends or extends a value's life, and its operands are
 *   counted by what reads them.
 * - An exit reads what it tests and what it returns.
 */

import type { BlockId, FlowFunction, Operation, ValueId } from '../../checker/surface/flow-ir.ts';
import { valuesReadBy } from '../../checker/surface/flow-ir.ts';
import type { LabelledScope } from '../../syntax/statements/index.ts';

export interface FlowUses {
  readonly reads: ReadonlyMap<ValueId, number>;
  readonly writes: ReadonlyMap<ValueId, number>;
  /** Each value a `keep` keeps, and the scope it is kept until. */
  readonly kept: ReadonlyMap<ValueId, LabelledScope | 'function'>;
}

/** How `flow` uses its values. */
export function usesOf(flow: FlowFunction): FlowUses {
  const uses: Counting = { reads: new Map(), writes: new Map(), kept: new Map() };
  for (const { operations, exit } of flow.blocks) {
    for (const operation of operations) {
      countUses(uses, operation);
    }
    for (const value of exitReads(exit)) {
      increment(uses.reads, value);
    }
  }
  return uses;
}

/** The counts being made, which `FlowUses` reads once made. */
interface Counting {
  readonly reads: Map<ValueId, number>;
  readonly writes: Map<ValueId, number>;
  readonly kept: Map<ValueId, LabelledScope | 'function'>;
}

/** Counts what `operation` reads, writes and keeps. */
function countUses({ reads, writes, kept }: Counting, operation: Operation): void {
  if (operation.op === 'keep') {
    for (const value of operation.values) {
      kept.set(value, operation.until);
    }
  } else if (operation.op !== 'release') {
    for (const value of valuesReadBy(operation)) {
      increment(reads, value);
    }
  }
  if ('into' in operation) {
    increment(writes, operation.into);
  }
}

function increment(counts: Map<ValueId, number>, value: ValueId): void {
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

/** What `exit` reads: the value its branch tests, the value it returns. */
function exitReads(exit: FlowFunction['blocks'][BlockId]['exit']): readonly ValueId[] {
  const tested = exit.kind === 'branch' && 'value' in exit.test ? [exit.test.value] : [];
  const returned = exit.kind === 'return' && exit.value !== undefined ? [exit.value] : [];
  return [...tested, ...returned];
}
