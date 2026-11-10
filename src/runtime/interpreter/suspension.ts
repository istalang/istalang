/**
 * Going on past the instructions an execution can stop at (spec §5, §8, §9): an `await` once its
 * future has resolved, a `select` at the case that won, and an instance root's `return`.
 *
 * - An instance's root that gives a future waits on it at its `return`, to end with its value
 *   (scheduler/segment/root-outcome.ts): only a root stops there, and it goes on by returning again,
 *   now that the future has resolved.
 * - A `select` picks the first case, in order, whose future has resolved. A blocking one picks
 *   when it resumes; one with `otherwise` picks at once, and goes to `otherwise` when no future has
 *   resolved.
 * - Entering a case releases what every other case's expression created (spec §8, "Losers are
 *   released"), binds the winner's value for `as`, and jumps to its body. The winner's holdings
 *   stay in their registers, for the enclosing block to release.
 */

import { awaitedRegisters } from '../../definition/instructions/flow.ts';
import type { Instruction } from '../../definition/instructions/instruction.ts';
import type { Register } from '../../definition/operands.ts';
import type { Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { ActiveFrame } from './frames.ts';
import { resumeAt } from './machine.ts';
import { clearRegister, readRegister, writeRegister } from './registers.ts';

/** How a frame learns whether the future a handle names has resolved, and with what. */
export type SettledOf = (handle: Value) => { readonly value: Value } | undefined;

type Select = Extract<Instruction, { kind: 'select' }>;

/**
 * The registers holding the futures a frame stopped at `instruction` waits on: an `await`'s or a
 * blocking `select`'s, or a root's `return`'s value; none where it doesn't wait.
 */
export function waitedRegisters(instruction: Instruction): readonly Register[] {
  return instruction.kind === 'return' ? [instruction.value] : awaitedRegisters(instruction);
}

/** The first case of `select`, in order, whose future has resolved, with its value. */
export function resolvedCase(
  frame: ActiveFrame,
  select: Select,
  settledOf: SettledOf,
): { readonly position: number; readonly value: Value } | undefined {
  for (const [position, selectCase] of select.cases.entries()) {
    const settled = settledOf(readRegister(frame, selectCase.future));
    if (settled !== undefined) {
      return { position, value: settled.value };
    }
  }
  return undefined;
}

/**
 * Continues `frame` at the case of `select` that won, or at `otherwise` when none did, releasing
 * the holdings of every case that lost.
 */
export function enterCase(
  frame: ActiveFrame,
  select: Select,
  winner: { readonly position: number; readonly value: Value } | undefined,
): void {
  for (const [position, selectCase] of select.cases.entries()) {
    if (position !== winner?.position) {
      for (const register of selectCase.holds) {
        clearRegister(frame, register);
      }
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

/**
 * Moves `frame`, stopped at an `await` or `select` whose future has resolved, past it; a root
 * stopped at its `return` stays there, to return again.
 */
export function resume(frame: ActiveFrame, settledOf: SettledOf): void {
  const instruction = frame.code.instructions[frame.pc];
  switch (instruction?.kind) {
    case 'return':
      return;
    case 'await': {
      const settled = settledOf(readRegister(frame, instruction.future));
      if (settled === undefined) {
        unreachable(`Resumed an await at pc ${frame.pc} whose future hasn't resolved.`);
      }
      resumeAt(frame, instruction.dst, settled.value);
      return;
    }
    case 'select':
      enterCase(frame, instruction, resolvedCase(frame, instruction, settledOf));
      return;
    default:
      unreachable(`Resumed at a ${instruction?.kind ?? 'missing'} instruction, not a wait.`);
  }
}
