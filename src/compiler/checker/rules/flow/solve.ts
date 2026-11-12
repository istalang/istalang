/**
 * Running a rule forward over a flow function (flow-ir.ts): a rule's state flows through the blocks
 * as the code runs, joining where paths meet, around a loop until what reaches its top stops
 * growing, and nowhere past a `return` or a stop. Blocks no path reaches are never run.
 */

import type { BlockId, Exit, FlowFunction, Operation } from './flow-ir.ts';

/** What a forward rule decides: what reaches where paths meet, and what an operation does. */
export interface ForwardRule<State> {
  /** What reaches a point where paths meet, from what each path brings. */
  readonly join: (states: readonly State[]) => State;
  /** Whether `later`, joined over `earlier`, holds nothing more: the point has settled. */
  readonly settled: (earlier: State, later: State) => boolean;
  /** The state after `operation`, run from `state`. */
  readonly operation: (operation: Operation, state: State) => State;
  /**
   * The state a block's operations start from, given what reaches it: a copy, for a rule whose
   * operations update their state in place rather than make a new one.
   */
  readonly enter?: (state: State) => State;
}

/**
 * What reaches the start of each block of `flow`, run from `entry`; undefined for a block no path
 * reaches.
 */
export function runForward<State>(
  flow: FlowFunction,
  rule: ForwardRule<State>,
  entry: State,
): readonly (State | undefined)[] {
  const reaching: (State | undefined)[] = flow.blocks.map(() => undefined);
  reaching[0] = entry;
  const pending = new Set<BlockId>([0]);
  for (const block of pending) {
    pending.delete(block);
    const { operations, exit } = flow.blocks[block] ?? { operations: [], exit: stop };
    const reached = reaching[block] as State;
    const start = rule.enter === undefined ? reached : rule.enter(reached);
    const state = operations.reduce(
      (before, operation) => rule.operation(operation, before),
      start,
    );
    for (const next of successorsOf(exit)) {
      if (reachesAnew(rule, reaching, next, state)) {
        pending.add(next);
      }
    }
  }
  return reaching;
}

const stop: Exit = { kind: 'stop' };

/** Joins `state` into what reaches `block`; whether that grew, so `block` runs again. */
function reachesAnew<State>(
  rule: ForwardRule<State>,
  reaching: (State | undefined)[],
  block: BlockId,
  state: State,
): boolean {
  const earlier = reaching[block];
  const later = earlier === undefined ? state : rule.join([earlier, state]);
  if (earlier !== undefined && rule.settled(earlier, later)) {
    return false;
  }
  reaching[block] = later;
  return true;
}

/** The blocks `exit` goes on to. */
function successorsOf(exit: Exit): readonly BlockId[] {
  if (exit.kind === 'goto') {
    return [exit.to];
  }
  return exit.kind === 'branch' ? exit.to : [];
}
