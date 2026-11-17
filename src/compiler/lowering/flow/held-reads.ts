/**
 * Which reads of a flow hold the value they read (§2: a value never changes once read;
 * docs/arch/definition.md, "Places"). A read of a variable at a name is the variable's register,
 * and a part read out of a value borrows it, as a one-element tuple's element taken out where the
 * element is expected does: both hold nothing, and stay what was read only while what they were
 * read out of does. A read something may change, in place or by replacing it, before its last use
 * holds its value instead, a holder of its own, so a write in place copies and a replaced value
 * outlives the read.
 *
 * - **A read's root** is the value it is read out of, at a name or through the reads it is a part
 *   of: a variable, or a computed value, which nothing else reaches, so only its release (a block
 *   ending before the part it gives is taken) changes it; a value several paths give is one.
 *   Through a handle (`behind`), a computed one too, what it reaches is the handle's state, others'
 *   as well.
 * - **What may change a root:** a write into its variable, whole or in part, a `&` argument rooted
 *   at it, or its release; and, where code other than the flow's own reaches it (a cell a closure
 *   or a nested call shares, the place a `&` parameter refers to or a `&` lent to an execution
 *   running on, a handle's state), anything that runs code: a call, a native's too (a test may mock
 *   it, and some run callbacks or disposals), a conversion, a getter, a wait, a write or a
 *   release, whose disposals run code.
 * - **Before its last use:** on some path from the read to a use of it, or of a part read out of
 *   it that holds nothing itself, not through the read again. A call reading it while it may change
 *   it is such a path: the call runs on with the value it was given.
 */

import { memo } from '../../../foundation/structures/memo.ts';
import { nodesReachedFrom } from '../../../foundation/structures/reachable.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import {
  type BlockId,
  type FlowBlock,
  type FlowFunction,
  type Operation,
  successorsOf,
  transientsOf,
  type ValueId,
} from '../../checker/surface/flow-ir.ts';
import type { Type } from '../../checker/types/type/index.ts';
import { awaitedOf } from '../../checker/types/type/well-known.ts';
import { type FlowPosition, usesOf } from './uses.ts';
import type { FlowWriter } from './writer.ts';

/** What deciding a flow's held reads needs to know beyond the flow. */
export interface ReadFacts {
  /** Whether code other than the flow's own reaches what variable `value` holds. */
  readonly reachable: (value: ValueId) => boolean;
}

/**
 * What `heldReads` needs to know of the flow `writer` writes: the variables other code reaches. A
 * cell this flow shares with a closure, the function enclosing it or the calls nested in it (a
 * transient's), the place a `&` parameter refers to, and one this flow passes by `&` to a call
 * giving a future, whose execution runs on with it.
 */
export function readFactsOf(writer: FlowWriter): ReadFacts {
  const { flow, context } = writer;
  const operations = flow.blocks.flatMap((block) => block.operations);
  const shared = new Set([
    ...flow.captures,
    ...transientsOf(flow),
    ...operations.flatMap((operation) =>
      operation.op === 'make' && operation.made.kind === 'closure' ? operation.parts : [],
    ),
  ]);
  const lent = new Set(
    operations.flatMap((operation) =>
      (operation.op === 'call' || operation.op === 'callValue') &&
      givesFuture(context.checker, flow.values[operation.into]?.type)
        ? operation.arguments.flatMap((each) => (each.kind === 'place' ? [each.place.root] : []))
        : [],
    ),
  );
  const reachable = (value: ValueId) => {
    const variable = writer.valueOf(value);
    if (variable.kind !== 'variable') {
      return false;
    }
    const referred =
      flow.parameters.includes(value) &&
      context.code.typeOf(writer.registerOf(value)).kind === 'reference';
    return referred || lent.has(value) || (variable.inCell && shared.has(value));
  };
  return { reachable };
}

function givesFuture(checker: Pick<Checker, 'wellKnownType'>, type: Type | undefined): boolean {
  return type !== undefined && awaitedOf(checker, type) !== undefined;
}

/**
 * What a read stays what it read while nothing changes: the value it is read out of at the base, a
 * variable or a computed value, and whether code other than the flow's own reaches it.
 */
interface Root {
  readonly value: ValueId;
  readonly reachable: boolean;
}

/** The reads of `flow` that hold their value, each the value it reads into. */
export function heldReads(flow: FlowFunction, facts: ReadFacts): ReadonlySet<ValueId> {
  const reads = readsOf(flow, facts);
  const uses = usesOf(flow).reads;
  const graph = graphOf(flow);
  const isVariable = (value: ValueId) => isVariableOf(flow, value);
  const held = new Set<ValueId>();
  /** Where each read is used, itself or through a part of it holding nothing. */
  const lasting = new Map<ValueId, readonly FlowPosition[]>();
  // Deciding a read decides the parts read out of it first, as they may make it last.
  const decided = (value: ValueId, read: Read): readonly FlowPosition[] =>
    memo(lasting, value, () => {
      const used = [
        ...(uses.get(value) ?? []),
        ...read.parts.flatMap((part) => {
          const partUsed = decided(part, reads.get(part) ?? unreachable(`No read into ${part}.`));
          return held.has(part) ? [] : partUsed;
        }),
      ];
      const changing = (operation: Operation) => changes(operation, read.root, isVariable);
      if (changedBeforeUse(graph, { at: read.at, used }, changing)) {
        held.add(value);
      }
      return used;
    });
  for (const [value, read] of reads) {
    decided(value, read);
  }
  return held;
}

function isVariableOf(flow: FlowFunction, value: ValueId): boolean {
  return flow.values[value]?.kind === 'variable';
}

/** A flow's blocks, and the blocks each is reached from. */
interface Graph {
  readonly flow: FlowFunction;
  readonly predecessors: ReadonlyMap<BlockId, readonly BlockId[]>;
}

function graphOf(flow: FlowFunction): Graph {
  const predecessors = new Map<BlockId, BlockId[]>();
  for (const [block, { exit }] of flow.blocks.entries()) {
    for (const target of successorsOf(exit)) {
      memo(predecessors, target, () => []).push(block);
    }
  }
  return { flow, predecessors };
}

/** A read of a flow: where it is, its root, and the reads of parts of it, which borrow from it. */
interface Read {
  readonly at: FlowPosition;
  readonly root: Root;
  readonly parts: ValueId[];
}

/**
 * Every read of `flow` into a temporary, by the value it reads into. A temporary several paths
 * give, an `if`'s or a `??`'s, holds what each gives it (writer.ts), so it reads nothing.
 */
function readsOf(flow: FlowFunction, facts: ReadFacts): ReadonlyMap<ValueId, Read> {
  const writeCounts = usesOf(flow).writes;
  const found = new Map(
    flow.blocks.flatMap(({ operations }, block) =>
      operations.flatMap((operation, index) => {
        const read = readOf(operation);
        return read === undefined ||
          isVariableOf(flow, read.into) ||
          (writeCounts.get(read.into) ?? 0) > 1
          ? []
          : [[read.into, { ...read, at: { block, index } }] as const];
      }),
    ),
  );
  const roots = new Map<ValueId, Root>();
  const rootOf = (value: ValueId): Root =>
    memo(roots, value, () => {
      const read = found.get(value);
      if (read === undefined) {
        const reachable = isVariableOf(flow, value) && facts.reachable(value);
        return { value, reachable };
      }
      const root = rootOf(read.from);
      return read.behind ? { ...root, reachable: true } : root;
    });
  const reads = new Map(
    [...found].map(([into, { at }]) => [into, { at, root: rootOf(into), parts: [] as ValueId[] }]),
  );
  for (const [into, { from }] of found) {
    reads.get(from)?.parts.push(into);
  }
  return reads;
}

/**
 * What `operation` reads into a temporary that may borrow it, if it does: a copy, fitted too (a
 * one-element tuple's element is a part of it), or a part. Holding one a conversion made a value
 * of its own of copies nothing (writer.ts).
 */
function readOf(
  operation: Operation,
): { readonly into: ValueId; readonly from: ValueId; readonly behind: boolean } | undefined {
  if (operation.op === 'copy' && operation.fit !== 'intoKeyedField') {
    return { into: operation.into, from: operation.from, behind: false };
  }
  if (operation.op === 'read' && operation.part.kind !== 'given') {
    return { into: operation.into, from: operation.from, behind: operation.part.kind === 'behind' };
  }
  return undefined;
}

/**
 * Whether a path from the read at `at` meets an operation `changing` finds, then a use of it in
 * `used`, without reaching the read again; a call that changes it while using it counts. Only the
 * blocks between the read and its uses are walked.
 */
function changedBeforeUse(
  { flow, predecessors }: Graph,
  { at, used }: { readonly at: FlowPosition; readonly used: readonly FlowPosition[] },
  changing: (operation: Operation) => boolean,
): boolean {
  const key = ({ block, index }: FlowPosition) => `${String(block)}:${String(index)}`;
  const usedAt = new Set(used.map(key));
  if (usedAt.size === 0) {
    return false;
  }
  const after = nodesReachedFrom([at.block], (block) => successorsOf(blockOf(flow, block).exit));
  const before = nodesReachedFrom(
    used.map(({ block }) => block),
    (block) => predecessors.get(block) ?? [],
  );
  const between = (block: BlockId) => after.has(block) && before.has(block);
  const seen = new Set<string>();
  const pending = successors(flow, at).map((position) => ({ position, changed: false }));
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { position, changed } = next;
    const seenKey = `${key(position)}:${String(changed)}`;
    if (key(position) !== key(at) && !seen.has(seenKey)) {
      seen.add(seenKey);
      const operation = blockOf(flow, position.block).operations[position.index];
      const changesHere = operation !== undefined && changing(operation);
      if (usedAt.has(key(position)) && (changed || (changesHere && runsWhileUsing(operation)))) {
        return true;
      }
      const now = changed || changesHere;
      pending.push(
        ...successors(flow, position)
          .filter(({ block }) => between(block))
          .map((each) => ({ position: each, changed: now })),
      );
    }
  }
  return false;
}

/** Whether `operation` may change what it reads while it still uses it: a call, a wait. */
function runsWhileUsing(operation: Operation | undefined): boolean {
  return operation?.op === 'call' || operation?.op === 'callValue' || operation?.op === 'suspend';
}

/** Where control goes from `position`: the next operation, or where its block's exit goes. */
function successors(flow: FlowFunction, { block, index }: FlowPosition): readonly FlowPosition[] {
  const current = blockOf(flow, block);
  if (index < current.operations.length) {
    return [{ block, index: index + 1 }];
  }
  return successorsOf(current.exit).map((target) => ({ block: target, index: 0 }));
}

function blockOf(flow: FlowFunction, block: BlockId): FlowBlock {
  return flow.blocks[block] ?? unreachable(`No block ${block}.`);
}

/** Whether `operation` may change what a read of `root` reads: releasing a computed root ends it. */
function changes(
  operation: Operation,
  root: Root,
  isVariable: (value: ValueId) => boolean,
): boolean {
  const written = writes(operation);
  if (written.includes(root.value)) {
    return true;
  }
  // Writing a variable ends what it held, whose disposal runs code.
  return root.reachable && (runsCode(operation) || written.some(isVariable));
}

/** The variables `operation` writes, whole or in part, by `&` or by ending them. */
function writes(operation: Operation): readonly ValueId[] {
  switch (operation.op) {
    case 'write':
      return [operation.place.root];
    case 'call':
    case 'callValue':
      return [
        operation.into,
        ...operation.arguments.flatMap((each) => (each.kind === 'place' ? [each.place.root] : [])),
      ];
    case 'release':
      return operation.values;
    default:
      return 'into' in operation ? [operation.into] : [];
  }
}

/** Whether `operation` may run code that reaches what a cell, reference or handle holds. */
function runsCode(operation: Operation): boolean {
  switch (operation.op) {
    case 'copy':
      return operation.fit !== undefined;
    case 'read':
      return operation.part.kind === 'required';
    case 'call':
    case 'callValue':
    case 'write':
    case 'suspend':
    case 'release':
      return true;
    default:
      return false;
  }
}
