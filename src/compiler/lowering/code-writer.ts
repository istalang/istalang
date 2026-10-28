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
import { unreachable } from '../../structures/unreachable.ts';
import type { Span } from '../../text/span.ts';

/** A place in the code, known once the code before it has been written. */
export interface Label {
  readonly id: number;
}

/** One case of a `select` being written: its future, what it holds, its `as` register, its body. */
export interface SelectCaseCode {
  readonly future: Register;
  readonly holds: readonly Register[];
  readonly bind: Register | undefined;
  readonly target: Label;
}

/** A function's code as written: how many registers its frame needs, and its instructions. */
export interface WrittenCode {
  readonly registers: number;
  readonly instructions: Instruction[];
}

export class CodeWriter {
  readonly #instructions: Instruction[] = [];
  /** The name `@Waypoint` gives the waits written now (§10); undefined outside such a statement. */
  #waypoint: string | undefined;
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

  /** Runs `write`; what it gave, and the registers allocated meanwhile, in order. */
  allocating<Result>(write: () => Result): {
    readonly result: Result;
    readonly registers: readonly Register[];
  } {
    const first = this.#registers;
    const result = write();
    return {
      result,
      registers: Array.from({ length: this.#registers - first }, (_, offset) => first + offset),
    };
  }

  emit(instruction: Instruction): void {
    this.#instructions.push(instruction);
  }

  /** Reads field `index` of the struct, variant or tuple in `src`; its register. */
  field(src: Register, index: number, span: Span): Register {
    const dst = this.allocate();
    this.emit({ kind: 'field', span, dst, src, index });
    return dst;
  }

  /** Reads the part of the value in `src` at `path`, field and element positions; its register. */
  readPath(src: Register, path: readonly number[], span: Span): Register {
    return path.reduce((current, index) => this.field(current, index, span), src);
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

  /**
   * Jumps by the variant of the enum value in `value`: to `targets[i]` for variant i, and to
   * `otherwise` for every variant past them.
   */
  switch(value: Register, targets: readonly Label[], span: Span, otherwise?: Label): void {
    const instruction: Extract<Instruction, { kind: 'switch' }> = {
      kind: 'switch',
      span,
      value,
      targets: targets.map(() => 0),
    };
    this.emit(instruction);
    for (const [index, target] of targets.entries()) {
      this.#refer(target, (position) => {
        instruction.targets[index] = position;
      });
    }
    if (otherwise !== undefined) {
      this.#refer(otherwise, (position) => {
        instruction.otherwise = position;
      });
    }
  }

  /** Writes what `write` writes, every wait in it named `waypoint` (§10). */
  withWaypoint(waypoint: string | undefined, write: () => void): void {
    const outer = this.#waypoint;
    this.#waypoint = waypoint ?? outer;
    try {
      write();
    } finally {
      this.#waypoint = outer;
    }
  }

  /** Waits on the future in `future`, its value then in `dst` (§5). */
  await(dst: Register, future: Register, span: Span): void {
    this.emit({ kind: 'await', span, dst, future, ...this.#waypointField() });
  }

  /** Chooses among `cases` by their futures (§8): waits for one, or goes to `otherwise` at once. */
  select(cases: readonly SelectCaseCode[], otherwise: Label | undefined, span: Span): void {
    const instruction: Extract<Instruction, { kind: 'select' }> = {
      kind: 'select',
      span,
      ...this.#waypointField(),
      cases: cases.map(({ future, holds, bind }) => ({
        future,
        holds: [...holds],
        ...(bind === undefined ? {} : { bind }),
        target: 0,
      })),
    };
    this.emit(instruction);
    for (const [index, { target }] of cases.entries()) {
      this.#refer(target, (position) => {
        const written = instruction.cases[index];
        if (written !== undefined) {
          written.target = position;
        }
      });
    }
    if (otherwise !== undefined) {
      instruction.otherwise = 0;
      this.#refer(otherwise, (position) => {
        instruction.otherwise = position;
      });
    }
  }

  /** The code written; throws when a jump names a label nothing placed, a bug in lowering. */
  finish(): WrittenCode {
    if (this.#patches.size > 0) {
      const labels = [...this.#patches.keys()].join(', ');
      unreachable(`Labels ${labels} are jumped to but never placed.`);
    }
    return { registers: this.#registers, instructions: this.#instructions };
  }

  #waypointField(): { readonly waypoint?: string } {
    return this.#waypoint === undefined ? {} : { waypoint: this.#waypoint };
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
