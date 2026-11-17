/**
 * Code the ownership verifier must refuse (ir-first design, "Verification"; plan: "the verifier
 * fails on a dropped or doubled hold"): mutants of a Definition's verified code, each broken one way.
 *
 * - **A dropped let-go:** a register taken out of every let-go, where one of them found it owning
 *   its value on every path and the call can still end from there. Lowering lets go of a register
 *   more than once (each scope's end and the call's), so taking out one let-go alone may leak
 *   nothing.
 * - **A dropped hold:** a `copy` some path reaches made a `move`, where its source is borrowed or read again on some
 *   path before anything writes it. A source only let go of later is moved correctly, so it is no
 *   mutant.
 * - **A doubled hold:** such a `copy` made twice into its register. It detours through code appended to
 *   the entry, so no jump target moves.
 */

import { type Instruction, operandsOf, successorsOf } from '../instructions/instruction.ts';
import type { Register } from '../operands.ts';
import type { CodeFunction } from '../tables/functions.ts';
import type { Definition } from '../tables/index.ts';
import { ownershipIssues, owningBefore } from './ownership.ts';

/** How a mutant breaks the code it was made of. */
type Breakage = 'dropped let-go' | 'dropped hold' | 'doubled hold';

export interface Mutant {
  readonly breakage: Breakage;
  readonly code: CodeFunction;
}

type Copy = Extract<Instruction, { kind: 'copy' }>;

/** Every mutant of each code entry of `definition` the verifier passes. */
export function brokenMutants(definition: Definition): readonly Mutant[] {
  return definition.functions.flatMap((code) =>
    code.kind !== 'code' || ownershipIssues(code).length > 0
      ? []
      : [...droppedLetGos(code), ...droppedHolds(code), ...doubledHolds(code)],
  );
}

function droppedLetGos(code: CodeFunction): Mutant[] {
  const owning = owningBefore(code);
  const registers = new Set(
    code.instructions.flatMap((instruction, pc) =>
      endsFrom(code, pc)
        ? releasedBy(instruction).filter((register) => owning[pc]?.has(register) === true)
        : [],
    ),
  );
  return [...registers].map((register) => ({
    breakage: 'dropped let-go',
    code: withoutLetGo(code, register),
  }));
}

function droppedHolds(code: CodeFunction): Mutant[] {
  return copiesOf(code).flatMap(({ copy, pc }) =>
    code.registers[copy.src]?.borrowed === true || readAgain(code, pc, copy.src)
      ? [{ breakage: 'dropped hold', code: replaced(code, pc, [{ ...copy, kind: 'move' }]) }]
      : [],
  );
}

function doubledHolds(code: CodeFunction): Mutant[] {
  return copiesOf(code).map(({ copy, pc }) => ({
    breakage: 'doubled hold',
    code: replaced(code, pc, [copy, copy]),
  }));
}

/** The `copy`s of `code` some path reaches: the verifier judges no other code. */
function copiesOf(code: CodeFunction): { readonly copy: Copy; readonly pc: number }[] {
  const reached = owningBefore(code);
  return code.instructions.flatMap((instruction, pc) =>
    instruction.kind === 'copy' && reached[pc] !== undefined ? [{ copy: instruction, pc }] : [],
  );
}

/**
 * `code` with the instruction at `pc` replaced by `instructions`: in place where it is one, else a
 * jump to them, appended, then back to the instruction after it.
 */
function replaced(
  code: CodeFunction,
  pc: number,
  instructions: readonly [Instruction, ...Instruction[]],
): CodeFunction {
  const [first] = instructions;
  if (instructions.length === 1) {
    return { ...code, instructions: code.instructions.with(pc, first) };
  }
  const { span } = first;
  return {
    ...code,
    instructions: [
      ...code.instructions.with(pc, { kind: 'jump', span, target: code.instructions.length }),
      ...instructions,
      { kind: 'jump', span, target: pc + 1 },
    ],
  };
}

/** Whether some path from past `pc` reads `register` before anything writes it; a let-go reads nothing. */
function readAgain(code: CodeFunction, pc: number, register: Register): boolean {
  return reaches(code, successorsOf(code.instructions[pc] as Instruction, pc), (instruction) => {
    if (instruction.kind === 'letGo') {
      return 'goOn';
    }
    const { read, written } = operandsOf(instruction);
    const reads = instruction.kind === 'return' ? [instruction.value] : read;
    if (reads.includes(register)) {
      return 'found';
    }
    return written.includes(register) ? 'stop' : 'goOn';
  });
}

/** Whether a call of `code` can still end from `pc`: some path reaches a `return` or `stopped`. */
function endsFrom(code: CodeFunction, pc: number): boolean {
  return reaches(code, [pc], (instruction) =>
    instruction.kind === 'return' || instruction.kind === 'stopped' ? 'found' : 'goOn',
  );
}

/**
 * Whether a path from `starts` meets an instruction `judge` finds, following paths through those it
 * goes on past and no further than those it stops at.
 */
function reaches(
  code: CodeFunction,
  starts: readonly number[],
  judge: (instruction: Instruction) => 'found' | 'goOn' | 'stop',
): boolean {
  const seen = new Set<number>();
  const pending = [...starts];
  for (let at = pending.pop(); at !== undefined; at = pending.pop()) {
    const instruction = code.instructions[at];
    if (instruction !== undefined && !seen.has(at)) {
      seen.add(at);
      const judged = judge(instruction);
      if (judged === 'found') {
        return true;
      }
      if (judged === 'goOn') {
        pending.push(...successorsOf(instruction, at));
      }
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
