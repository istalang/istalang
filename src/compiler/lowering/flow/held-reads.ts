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
 *   ending before the part it gives is taken) changes it. Through a handle (`behind`), a computed
 *   one too, what it reaches is the handle's state, others' as well.
 * - **What may change a root:** a write into its variable, whole or in part, a `&` argument rooted
 *   at it, or its release; and, where code other than the flow's own reaches it (a cell a closure
 *   or a nested call shares, the place a `&` parameter refers to, a handle's state), anything that
 *   runs code: a call but a native's reading only the values it is given, a conversion, a getter,
 *   a wait, a write or a release, whose disposals run code.
 * - **Before its last use:** on some path from the read to a use of it, or of a part read out of
 *   it that holds nothing itself, not through the read again. A call reading it while it may change
 *   it is such a path: the call runs on with the value it was given.
 */

import { memo } from '../../../foundation/structures/memo.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import {
  type BlockId,
  type Exit,
  type FlowFunction,
  type Operation,
  transientsOf,
  type ValueId,
} from '../../checker/surface/flow-ir.ts';
import { ownEntryOf } from '../tables/own-entries.ts';
import { type FlowPosition, usesOf } from './uses.ts';
import type { FlowWriter } from './writer.ts';

/** What deciding a flow's held reads needs to know beyond the flow. */
export interface ReadFacts {
  /** Whether code other than the flow's own reaches what variable `value` holds. */
  readonly reachable: (value: ValueId) => boolean;
  /** Whether `operation`, a call, runs only a native reading the values it is given. */
  readonly readsOnly: (operation: Operation) => boolean;
}

/**
 * What `heldReads` needs to know of the flow `writer` writes: the variables other code reaches (a
 * cell this flow shares with a closure, the function enclosing it or the calls nested in it, a
 * transient's; a `&` parameter's place), and the calls of a native taking values alone, each
 * closed in its block's passes (`inPasses`).
 */
export function readFactsOf(
  writer: FlowWriter,
  inPasses: (block: BlockId, read: () => void) => void,
): ReadFacts {
  const { flow, context } = writer;
  const shared = new Set([...flow.captures, ...transientsOf(flow)]);
  const readingOnly = new Set<Operation>();
  for (const [block, { operations }] of flow.blocks.entries()) {
    for (const operation of operations) {
      if (operation.op === 'make' && operation.made.kind === 'closure') {
        for (const part of operation.parts) {
          shared.add(part);
        }
      }
    }
    inPasses(block, () => {
      for (const operation of operations) {
        if (operation.op === 'call' && callsNativeOnValues(writer, operation)) {
          readingOnly.add(operation);
        }
      }
    });
  }
  const reachable = (value: ValueId) => {
    const variable = writer.valueOf(value);
    if (variable.kind !== 'variable') {
      return false;
    }
    const referred =
      flow.parameters.includes(value) &&
      context.code.typeOf(writer.registerOf(value)).kind === 'reference';
    return referred || (variable.inCell && shared.has(value));
  };
  return { reachable, readsOnly: (operation) => readingOnly.has(operation) };
}

/** Whether `operation` calls a native, giving it values alone, none a function to call back. */
function callsNativeOnValues(
  writer: FlowWriter,
  operation: Extract<Operation, { readonly op: 'call' }>,
): boolean {
  const closed = writer.context.closed(operation.call);
  return (
    closed.kind !== 'dispatch' &&
    ownEntryOf(writer.context.checker, closed.instance).kind === 'native' &&
    operation.arguments.every(
      (argument) => argument.kind === 'value' && writer.typeOf(argument.value).kind !== 'function',
    )
  );
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
  const judging = { ...facts, isVariable: (value: ValueId) => isVariableOf(flow, value) };
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
      const changing = (operation: Operation) => changes(operation, read.root, judging);
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
    for (const target of targetsOf(exit)) {
      memo(predecessors, target, () => []).push(block);
    }
  }
  return { flow, predecessors };
}

/** The blocks reached from `starts` going `next`, `starts` among them. */
function reached(starts: readonly BlockId[], next: (block: BlockId) => readonly BlockId[]) {
  const seen = new Set<BlockId>(starts);
  const pending = [...starts];
  for (let block = pending.pop(); block !== undefined; block = pending.pop()) {
    for (const each of next(block)) {
      if (!seen.has(each)) {
        seen.add(each);
        pending.push(each);
      }
    }
  }
  return seen;
}

/** A read of a flow: where it is, its root, and the reads of parts of it, which borrow from it. */
interface Read {
  readonly at: FlowPosition;
  readonly root: Root;
  readonly parts: ValueId[];
}

/** Every read of `flow` into a temporary, by the value it reads into. */
function readsOf(flow: FlowFunction, facts: ReadFacts): ReadonlyMap<ValueId, Read> {
  const found = new Map(
    flow.blocks.flatMap(({ operations }, block) =>
      operations.flatMap((operation, index) => {
        const read = readOf(operation);
        return read === undefined || isVariableOf(flow, read.into)
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
  const after = reached([at.block], (block) => targetsOf(flow.blocks[block]?.exit));
  const before = reached(
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
      const operation = flow.blocks[position.block]?.operations[position.index];
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
  const current = flow.blocks[block];
  if (current === undefined) {
    return [];
  }
  if (index < current.operations.length) {
    return [{ block, index: index + 1 }];
  }
  return targetsOf(current.exit).map((target) => ({ block: target, index: 0 }));
}

function targetsOf(exit: Exit | undefined): readonly BlockId[] {
  switch (exit?.kind) {
    case 'goto':
      return [exit.to];
    case 'branch':
      return exit.to;
    default:
      return [];
  }
}

/** Whether `operation` may change what a read of `root` reads: releasing a computed root ends it. */
function changes(
  operation: Operation,
  root: Root,
  facts: ReadFacts & { readonly isVariable: (value: ValueId) => boolean },
): boolean {
  const written = writes(operation);
  if (written.includes(root.value)) {
    return true;
  }
  // Writing a variable ends what it held, whose disposal runs code.
  return root.reachable && (runsCode(operation, facts) || written.some(facts.isVariable));
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
function runsCode(operation: Operation, facts: ReadFacts): boolean {
  switch (operation.op) {
    case 'call':
    case 'callValue':
      return !facts.readsOnly(operation);
    case 'copy':
      return operation.fit !== undefined;
    case 'read':
      return operation.part.kind === 'required';
    case 'write':
    case 'suspend':
    case 'release':
      return true;
    default:
      return false;
  }
}
