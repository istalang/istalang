/**
 * The ownership verifier catches a register never let go of (ir-first design, "Verification"):
 * over the corpus's compiled code, taking a register out of every let-go leaves code the verifier
 * refuses, where one of them found it owning its value on every path and the call can still end
 * from there. Lowering lets go of a register more than once (each scope's end and the call's), so
 * taking out one let-go alone may leak nothing.
 */

import fc from 'fast-check';
import { expect, it } from 'vitest';
import { corpusDirectory, runPrograms } from '../../../test/corpus/programs.ts';
import { compiledAt } from '../../../test/golden/pipeline.ts';
import { successorsOf } from '../instructions/instruction.ts';
import type { Register } from '../operands.ts';
import type { CodeFunction } from '../tables/functions.ts';
import { ownershipIssues, owningBefore } from './ownership.ts';

/** A register of a code entry to take out of every let-go. */
interface Dropped {
  readonly code: CodeFunction;
  readonly register: Register;
}

/** Each register of the corpus's verified code some let-go finds owning, whence the call can end. */
const drops: readonly Dropped[] = runPrograms.flatMap(({ name, text }) => {
  const compiled = compiledAt(corpusDirectory, name, text);
  if ('problem' in compiled) {
    return [];
  }
  return compiled.definition.functions.flatMap((code) => {
    if (code.kind !== 'code' || ownershipIssues(code).length > 0) {
      return [];
    }
    const owning = owningBefore(code);
    const registers = new Set(
      code.instructions.flatMap((instruction, pc) =>
        instruction.kind === 'letGo' && endsFrom(code, pc)
          ? instruction.registers.filter((register) => owning[pc]?.has(register) === true)
          : [],
      ),
    );
    return [...registers].map((register) => ({ code, register }));
  });
});

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

/** `code` with `register` taken out of every let-go. */
function withoutLetGo({ code, register }: Dropped): CodeFunction {
  return {
    ...code,
    instructions: code.instructions.map((instruction) =>
      instruction.kind === 'letGo'
        ? { ...instruction, registers: instruction.registers.filter((each) => each !== register) }
        : instruction,
    ),
  };
}

it('refuses code never letting go of a register it owns', () => {
  expect(drops.length).toBeGreaterThan(0);
  fc.assert(
    fc.property(fc.nat({ max: drops.length - 1 }), (index) => {
      const dropped = drops[index] as Dropped;
      expect(ownershipIssues(withoutLetGo(dropped))).not.toEqual([]);
    }),
    { numRuns: 500 },
  );
}, 120_000);
