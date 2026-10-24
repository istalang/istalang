/**
 * How instructions direct execution: which ones stop it to wait, and which ones never continue to
 * the next instruction. Load validation, snapshot checks and the scheduler all ask here, so a new
 * way to wait (the concurrency slice's `select`) changes one module.
 *
 * - `await` waits on one future. A `select` without `otherwise` waits until one of its cases'
 *   futures resolves (§8); with `otherwise` it chooses at once and never waits. A waiting
 *   instruction is the only place a frame can stand in a snapshot (§5).
 * - `select` always jumps to the case it picks, so it ends straight-line code like a jump does.
 */

import type { Register } from '../operands.ts';
import type { Instruction, InstructionKind } from './instruction.ts';

/** The registers holding the futures `instruction` waits on; empty when it doesn't wait. */
export function awaitedRegisters(instruction: Instruction): readonly Register[] {
  switch (instruction.kind) {
    case 'await':
      return [instruction.future];
    case 'select':
      return instruction.otherwise === undefined ? instruction.cases.map((c) => c.future) : [];
    default:
      return [];
  }
}

/** Whether execution can stop at `instruction` to wait, which commits the segment first. */
export function waits(instruction: Instruction): boolean {
  return awaitedRegisters(instruction).length > 0;
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
