/**
 * Going on past the instructions an execution can stop at (spec §5, §8): an `await` and a `select`,
 * at the case that won.
 *
 * - Each names the wait it ends, in a register (proposal 8, Rule 5): a blocking one resumes as that
 *   wait was decided (scheduler/instance/waits/index.ts), and a `select` with `otherwise` goes to
 *   the case it was decided at already, or to `otherwise`. Ending a wait takes it out of its
 *   register: the wait goes then, so nothing notes it let go of.
 * - The cases a `select` lost let go of what their expressions created (spec §8, "Losers are
 *   released") once the winner is decided, which for a blocking one is before it resumes. A losing
 *   case's resolver still to resume a disposed call on its `disposing()` watch holds that watch
 *   itself, its wait holding it (§7; scheduler/instance/waits/index.ts), so its registers go too.
 * - Entering the winning case lets go of every other case's holdings left, binds its value for
 *   `as`, and jumps to its body. The winner's holdings stay in their registers, for the enclosing
 *   block to release.
 */

import { waitRegister } from '../../definition/instructions/flow.ts';
import type { Instruction } from '../../definition/instructions/instruction.ts';
import { handleTarget, type Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { ActiveFrame } from './frames.ts';
import { resumeAt } from './machine.ts';
import { clearRegister, readRegister, writeRegister } from './registers.ts';

/** Where a wait resumes: the case that won, by position (an `await`'s is 0), and its value. */
export interface Decision {
  readonly position: number;
  readonly value: Value;
}

type Select = Extract<Instruction, { kind: 'select' }>;

/** The wait `frame` stands at, an `await`'s or a `select`'s, by id; undefined elsewhere. */
function waitAt(frame: ActiveFrame): number | undefined {
  const instruction = frame.code.instructions[frame.pc];
  const register =
    instruction?.kind === 'await' || instruction?.kind === 'select' ? instruction.wait : undefined;
  return register === undefined || frame.registers[register] === undefined
    ? undefined
    : handleTarget(readRegister(frame, register));
}

/** The wait `frame` is stopped at, by id: an `await`'s or a blocking `select`'s, until it ends. */
export function stoppedAt(frame: ActiveFrame): number | undefined {
  const instruction = frame.code.instructions[frame.pc];
  return instruction !== undefined && waitRegister(instruction) !== undefined
    ? waitAt(frame)
    : undefined;
}

/**
 * Takes the wait `frame` stands at out of its register, as the wait ends and goes with it, so
 * nothing notes it let go of; its id.
 */
export function takeWait(frame: ActiveFrame): number | undefined {
  const wait = waitAt(frame);
  const instruction = frame.code.instructions[frame.pc];
  if (wait !== undefined && (instruction?.kind === 'await' || instruction?.kind === 'select')) {
    frame.registers[instruction.wait] = undefined;
  }
  return wait;
}

/**
 * Lets go of what every case lost by the blocking `select` `frame` waits at created, as its wait is
 * decided at `winner`. Whether it let go of anything.
 */
export function releaseLosers(frame: ActiveFrame, winner: number): boolean {
  const instruction = frame.code.instructions[frame.pc];
  if (instruction?.kind !== 'select') {
    return false;
  }
  let released = false;
  for (const [position, selectCase] of instruction.cases.entries()) {
    if (position !== winner) {
      released = releaseCase(frame, selectCase) || released;
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

/** Lets go of what `selectCase`'s expression created; whether there was anything to let go of. */
function releaseCase(frame: ActiveFrame, selectCase: Select['cases'][number]): boolean {
  let released = false;
  for (const register of selectCase.holds) {
    if (frame.registers[register] !== undefined) {
      clearRegister(frame, register);
      released = true;
    }
  }
  return released;
}
