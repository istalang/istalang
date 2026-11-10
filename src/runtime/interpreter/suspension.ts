/**
 * Going on past the instructions an execution can stop at (spec §5, §8): an `await` and a `select`,
 * at the case that won.
 *
 * - A blocking wait resumes as its resolver decided (scheduler/instance/resolvers.ts): at the first
 *   case whose future resolved, the lowest among those that resolved together. A `select` with
 *   `otherwise` picks at once the first case, in order, whose future has resolved, and goes to
 *   `otherwise` when none has.
 * - The cases a `select` lost let go of what their expressions created (spec §8, "Losers are
 *   released") once the winner is decided, which for a blocking one is before it resumes. A case
 *   on the call's own `disposing()` watch is kept until then, as a disposal still resumes the call
 *   on it (§7).
 * - Entering the winning case lets go of every other case's holdings left, binds its value for
 *   `as`, and jumps to its body. The winner's holdings stay in their registers, for the enclosing
 *   block to release.
 */

import { awaitedRegisters } from '../../definition/instructions/flow.ts';
import type { Instruction } from '../../definition/instructions/instruction.ts';
import type { Register } from '../../definition/operands.ts';
import { handleTarget, type Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { ActiveFrame } from './frames.ts';
import { resumeAt } from './machine.ts';
import { clearRegister, readRegister, writeRegister } from './registers.ts';

/** How a frame learns whether the future a handle names has resolved, and with what. */
export type SettledOf = (handle: Value) => { readonly value: Value } | undefined;

/** Where a wait resumes: the case that won, by position (an `await`'s is 0), and its value. */
export interface Decision {
  readonly position: number;
  readonly value: Value;
}

type Select = Extract<Instruction, { kind: 'select' }>;

/**
 * The futures the wait `frame` stands at names, by case position; undefined where a case has let
 * go of its own.
 */
export function waitingOn(frame: ActiveFrame): readonly (number | undefined)[] {
  const instruction = frame.code.instructions[frame.pc];
  return (instruction === undefined ? [] : awaitedRegisters(instruction)).map((register) =>
    frame.registers[register] === undefined
      ? undefined
      : handleTarget(readRegister(frame, register)),
  );
}

/** The first case of `select`, in order, whose future has resolved, with its value. */
export function resolvedCase(
  frame: ActiveFrame,
  select: Select,
  settledOf: SettledOf,
): Decision | undefined {
  for (const [position, selectCase] of select.cases.entries()) {
    const settled = settledOf(readRegister(frame, selectCase.future));
    if (settled !== undefined) {
      return { position, value: settled.value };
    }
  }
  return undefined;
}

/**
 * Lets go of what every case lost by the blocking `select` `frame` waits at created, as its wait is
 * decided at `winner`; a case on a future `kept` keeps keeps only that future. Whether it let go of
 * anything.
 */
export function releaseLosers(
  frame: ActiveFrame,
  winner: number,
  kept: (future: number) => boolean,
): boolean {
  const instruction = frame.code.instructions[frame.pc];
  if (instruction?.kind !== 'select') {
    return false;
  }
  const futures = waitingOn(frame);
  let released = false;
  for (const [position, selectCase] of instruction.cases.entries()) {
    const future = futures[position];
    if (position !== winner) {
      const keeps = future !== undefined && kept(future) ? selectCase.future : undefined;
      released = releaseCase(frame, selectCase, keeps) || released;
    }
  }
  return released;
}

/**
 * Continues `frame` at the case of `select` that won, or at `otherwise` when none did, releasing
 * the holdings of every case that lost.
 */
export function enterCase(frame: ActiveFrame, select: Select, winner: Decision | undefined): void {
  for (const [position, selectCase] of select.cases.entries()) {
    if (position !== winner?.position) {
      releaseCase(frame, selectCase);
    }
  }
  const chosen = winner === undefined ? undefined : select.cases[winner.position];
  if (chosen === undefined) {
    if (select.otherwise === undefined) {
      unreachable('A blocking select resumed with no case resolved.');
    }
    frame.pc = select.otherwise;
    return;
  }
  if (chosen.bind !== undefined && winner !== undefined) {
    writeRegister(frame, chosen.bind, winner.value);
  }
  frame.pc = chosen.target;
}

/** Moves `frame`, stopped at an `await` or a blocking `select`, past it as `decision` says. */
export function resume(frame: ActiveFrame, decision: Decision): void {
  const instruction = frame.code.instructions[frame.pc];
  switch (instruction?.kind) {
    case 'await':
      resumeAt(frame, instruction.dst, decision.value);
      return;
    case 'select':
      enterCase(frame, instruction, decision);
      return;
    default:
      unreachable(`Resumed at a ${instruction?.kind ?? 'missing'} instruction, not a wait.`);
  }
}

/**
 * Lets go of what `selectCase`'s expression created, but for the register `keeps`, if any; whether
 * there was anything to let go of.
 */
function releaseCase(
  frame: ActiveFrame,
  selectCase: Select['cases'][number],
  keeps?: Register,
): boolean {
  let released = false;
  for (const register of selectCase.holds) {
    if (register !== keeps && frame.registers[register] !== undefined) {
      clearRegister(frame, register);
      released = true;
    }
  }
  return released;
}
