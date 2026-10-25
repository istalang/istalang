/**
 * Going on past the instructions an execution can stop at (spec §5, §8): an `await` once its
 * future has resolved, and a `select` at the case that won.
 *
 * - A `select` picks the first case, in order, whose future has resolved. A blocking one picks
 *   when it resumes; one with `otherwise` picks at once, and goes to `otherwise` when no future has
 *   resolved.
 * - Entering a case releases what every other case's expression created (spec §8, "Losers are
 *   released"), binds the winner's value for `as`, and jumps to its body. The winner's holdings
 *   stay in their registers, for the enclosing block to release.
 */

import type { Instruction } from '../../definition/instructions/instruction.ts';
import type { Value } from '../../definition/values.ts';
import {
  type ActiveFrame,
  clearRegister,
  readRegister,
  resumeAt,
  writeRegister,
} from './machine.ts';

/** How a frame learns whether the future a handle names has resolved, and with what. */
export type SettledOf = (handle: Value) => { readonly value: Value } | undefined;

type Select = Extract<Instruction, { kind: 'select' }>;

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
      throw new Error('A blocking select resumed with no case resolved.');
    }
    frame.pc = select.otherwise;
    return;
  }
  if (chosen.bind !== undefined && winner !== undefined) {
    writeRegister(frame, chosen.bind, winner.value);
  }
  frame.pc = chosen.target;
}

/** Moves `frame`, stopped at an `await` or `select` whose future has resolved, past it. */
export function resume(frame: ActiveFrame, settledOf: SettledOf): void {
  const instruction = frame.code.instructions[frame.pc];
  switch (instruction?.kind) {
    case 'await': {
      const settled = settledOf(readRegister(frame, instruction.future));
      if (settled === undefined) {
        throw new Error(`Resumed an await at pc ${frame.pc} whose future hasn't resolved.`);
      }
      resumeAt(frame, instruction.dst, settled.value);
      return;
    }
    case 'select':
      enterCase(frame, instruction, resolvedCase(frame, instruction, settledOf));
      return;
    default:
      throw new Error(`Resumed at a ${instruction?.kind ?? 'missing'} instruction, not a wait.`);
  }
}
