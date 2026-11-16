/**
 * Code the ownership verifier must refuse (ir-first design, "Verification"): a Definition's verified
 * code with a register taken out of every let-go, where one of them found it owning its value on
 * every path and the call can still end from there. Lowering lets go of a register more than once
 * (each scope's end and the call's), so taking out one let-go alone may leak nothing.
 */

import type { Definition } from '../definition.ts';
import { type Instruction, successorsOf } from '../instructions/instruction.ts';
import type { Register } from '../operands.ts';
import type { CodeFunction } from '../tables/functions.ts';
import { ownershipIssues, owningBefore } from './ownership.ts';

/** Each code entry of `definition` the verifier passes, with an owned register it never lets go of. */
export function leakingMutants(definition: Definition): readonly CodeFunction[] {
  return definition.functions.flatMap((code) => {
    if (code.kind !== 'code' || ownershipIssues(code).length > 0) {
      return [];
    }
    const owning = owningBefore(code);
    const registers = new Set(
      code.instructions.flatMap((instruction, pc) =>
        endsFrom(code, pc)
          ? releasedBy(instruction).filter((register) => owning[pc]?.has(register) === true)
          : [],
      ),
    );
    return [...registers].map((register) => withoutLetGo(code, register));
  });
}

/** Whether a call of `code` can still end from `pc`: some path reaches a `return` or `stopped`. */
function endsFrom(code: CodeFunction, pc: number): boolean {
  const seen = new Set<number>();
  const pending = [pc];
  for (let at = pending.pop(); at !== undefined; at = pending.pop()) {
    const instruction = code.instructions[at];
    if (instruction !== undefined && !seen.has(at)) {
      seen.add(at);
      if (instruction.kind === 'return' || instruction.kind === 'stopped') {
        return true;
      }
      pending.push(...successorsOf(instruction, at));
    }
  }
  return false;
}

/** The registers `instruction` lets go of: a `letGo`'s, or a `return`'s releasing. */
function releasedBy(instruction: Instruction): readonly Register[] {
  switch (instruction.kind) {
    case 'letGo':
      return instruction.registers;
    case 'return':
      return instruction.releasing;
    default:
      return [];
  }
}

/** `code` with `register` taken out of every let-go. */
function withoutLetGo(code: CodeFunction, register: Register): CodeFunction {
  const kept = (registers: readonly Register[]) => registers.filter((each) => each !== register);
  return {
    ...code,
    instructions: code.instructions.map((instruction) => {
      switch (instruction.kind) {
        case 'letGo':
          return { ...instruction, registers: kept(instruction.registers) };
        case 'return':
          return { ...instruction, releasing: kept(instruction.releasing) };
        default:
          return instruction;
      }
    }),
  };
}
