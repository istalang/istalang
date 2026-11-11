/**
 * How instructions direct execution: which ones stop it to wait, and which ones never continue to
 * the next instruction. Load validation, snapshot checks and the scheduler all ask here, so a new
 * way to wait (the concurrency slice's `select`) changes one module.
 *
 * - `await`, and a `select` without `otherwise`, waits until the wait its register holds is decided
 *   (§8; proposal 8, Rule 5); with `otherwise` a `select` chooses at once and never waits. A
 *   waiting instruction is the only place a frame can stand in a snapshot (§5).
 * - `select` always jumps to the case it picks, so it ends straight-line code like a jump does.
 */

import type { Register } from '../operands.ts';
import type { Instruction, InstructionKind } from './instruction.ts';

/**
 * The register holding the wait `instruction` stops at (`await`, or a `select` without
 * `otherwise`); undefined when it doesn't wait.
 */
export function waitRegister(instruction: Instruction): Register | undefined {
  switch (instruction.kind) {
    case 'await':
      return instruction.wait;
    case 'select':
      return instruction.otherwise === undefined ? instruction.wait : undefined;
    default:
      return undefined;
  }
}

/** Whether execution can stop at `instruction` to wait, which commits the segment first. */
export function waits(instruction: Instruction): boolean {
  return waitRegister(instruction) !== undefined;
}

const terminators: ReadonlySet<InstructionKind> = new Set([
  'return',
  'jump',
  'branch',
  'switch',
  'select',
]);

/** Whether execution never continues from `instruction` to the one after it. */
export function terminates(instruction: Instruction): boolean {
  return terminators.has(instruction.kind);
}
