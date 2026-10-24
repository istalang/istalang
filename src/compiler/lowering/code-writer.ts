/**
 * Writing one function's code (docs/arch/definition.md, "Frames"): its registers, its
 * instructions, and the labels its jumps name.
 *
 * - Registers are numbered as the frame lays them out: parameters first, then locals and
 *   temporaries, each a fresh register. Nothing is reused, so a register's meaning never changes
 *   within a function, which keeps the code easy to read back from a snapshot.
 * - A jump to a label not yet placed is patched when the label is placed, so code is written in a
 *   single pass. A label a jump names but nothing places would leave the jump at instruction 0,
 *   which loading can't tell from a real target, so finishing refuses code with one.
 */

import type { Instruction } from '../../definition/instructions/instruction.ts';
import type { Register } from '../../definition/operands.ts';
import type { Span } from '../../text/span.ts';

/** A place in the code, known once the code before it has been written. */
export interface Label {
  readonly id: number;
}

/** A function's code as written: how many registers its frame needs, and its instructions. */
export interface WrittenCode {
  readonly registers: number;
  readonly instructions: Instruction[];
}

export class CodeWriter {
  readonly #instructions: Instruction[] = [];
  readonly #placed = new Map<number, number>();
  readonly #patches = new Map<number, ((position: number) => void)[]>();
  #registers = 0;
  #labels = 0;

  /** A fresh register. */
  allocate(): Register {
    const register = this.#registers;
    this.#registers += 1;
    return register;
  }

  emit(instruction: Instruction): void {
    this.#instructions.push(instruction);
  }

  newLabel(): Label {
    this.#labels += 1;
    return { id: this.#labels };
  }

  /** Places `label` at the next instruction. */
  place(label: Label): void {
    const position = this.#instructions.length;
    this.#placed.set(label.id, position);
    for (const patch of this.#patches.get(label.id) ?? []) {
      patch(position);
    }
    this.#patches.delete(label.id);
  }

  jump(target: Label, span: Span): void {
    const instruction: Extract<Instruction, { kind: 'jump' }> = { kind: 'jump', span, target: 0 };
    this.emit(instruction);
    this.#refer(target, (position) => {
      instruction.target = position;
    });
  }

  branch(condition: Register, whenTrue: Label, whenFalse: Label, span: Span): void {
    const instruction: Extract<Instruction, { kind: 'branch' }> = {
      kind: 'branch',
      span,
      condition,
      whenTrue: 0,
      whenFalse: 0,
    };
    this.emit(instruction);
    this.#refer(whenTrue, (position) => {
      instruction.whenTrue = position;
    });
    this.#refer(whenFalse, (position) => {
      instruction.whenFalse = position;
    });
  }

  /** The code written; throws when a jump names a label nothing placed, a bug in lowering. */
  finish(): WrittenCode {
    if (this.#patches.size > 0) {
      const labels = [...this.#patches.keys()].join(', ');
      throw new Error(`Labels ${labels} are jumped to but never placed.`);
    }
    return { registers: this.#registers, instructions: this.#instructions };
  }

  /** Sets a label's position into an instruction now, or when the label is placed. */
  #refer(label: Label, patch: (position: number) => void): void {
    const position = this.#placed.get(label.id);
    if (position === undefined) {
      this.#patches.set(label.id, [...(this.#patches.get(label.id) ?? []), patch]);
    } else {
      patch(position);
    }
  }
}
