/**
 * Writing one function's code (docs/arch/definition.md, "Frames"): its registers, its
 * instructions, and the labels its jumps name.
 *
 * - Registers are numbered as the frame lays them out: parameters first, then locals and
 *   temporaries, each a fresh register. Nothing is reused, so a register's meaning never changes
 *   within a function, which keeps the code easy to read back from a snapshot.
 * - An instruction is written at the span of the syntax it stands for (syntax/tree/positions.ts),
 *   and finishing turns every span into its module's text positions, the one place lowering does.
 * - A jump to a label not yet placed is patched when the label is placed, so code is written in a
 *   single pass. A label a jump names but nothing places would leave the jump at instruction 0,
 *   which loading can't tell from a real target, so finishing refuses code with one.
 */

import type { Instruction } from '../../../definition/instructions/instruction.ts';
import type { Register } from '../../../definition/operands.ts';
import { addToGroup } from '../../../foundation/structures/groups.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { type AnchoredSpan, type SegmentBases, spanIn } from '../../syntax/tree/positions.ts';

/** A place in the code, known once the code before it has been written. */
export interface Label {
  readonly id: number;
}

/** One case of a `select` being written: what it holds, its `as` register, its body. */
interface SelectCaseCode {
  readonly holds: readonly Register[];
  readonly bind: Register | undefined;
  readonly target: Label;
}

/** An instruction as lowering writes it: at the span of the syntax it stands for. */
export type WrittenInstruction = Instruction extends infer Each
  ? Each extends Instruction
    ? Omit<Each, 'span'> & { readonly span: AnchoredSpan }
    : never
  : never;

/**
 * A function's code as written: how many registers its frame needs, which of them may hold what
 * reaches a disposable, and its instructions.
 */
interface WrittenCode {
  readonly registers: number;
  readonly counted: Register[];
  readonly instructions: Instruction[];
}

export class CodeWriter {
  readonly #instructions: WrittenInstruction[] = [];
  /** The name `@Waypoint` gives the waits written now (§10); undefined outside such a statement. */
  #waypoint: string | undefined;
  readonly #placed = new Map<number, number>();
  readonly #patches = new Map<number, ((position: number) => void)[]>();
  #registers = 0;
  #labels = 0;
  /** The registers found to hold only what reaches no disposable (`holdsPlain`). */
  readonly #plain = new Set<Register>();

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

  /**
   * Notes that `register` holds only values reaching no disposable (spec §7), as their types say:
   * a runtime counting holders per register needn't count it. A register nothing says this of is
   * counted, so a register whose values lowering can't name stays safe.
   */
  holdsPlain(register: Register): void {
    this.#plain.add(register);
  }

  emit(instruction: WrittenInstruction): void {
    this.#instructions.push(instruction);
  }

  /** Reads field `index` of the struct, variant or tuple in `src`; its register. */
  field(src: Register, index: number, span: AnchoredSpan): Register {
    const dst = this.allocate();
    this.emit({ kind: 'field', span, dst, src, index });
    return dst;
  }

  /** Whether the values in `left` and `right` are equal, by the built-in `equal`; its register. */
  equal(left: Register, right: Register, span: AnchoredSpan): Register {
    const dst = this.allocate();
    this.emit({ kind: 'equal', span, dst, left, right });
    return dst;
  }

  /** Reads the part of the value in `src` at `path`, field and element positions; its register. */
  readPath(src: Register, path: readonly number[], span: AnchoredSpan): Register {
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

  jump(target: Label, span: AnchoredSpan): void {
    this.#emitJumping({ kind: 'jump', span, target: 0 }, target);
  }

  branch(condition: Register, whenTrue: Label, whenFalse: Label, span: AnchoredSpan): void {
    const instruction: Extract<WrittenInstruction, { kind: 'branch' }> = {
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

  /** Jumps to `target` when the call gave parameter `parameter`, skipping its default (§3.3). */
  given(parameter: Register, target: Label, span: AnchoredSpan): void {
    this.#emitJumping({ kind: 'given', span, parameter, target: 0 }, target);
  }

  /**
   * Reads the instance's value of the context constant `name` into `dst` and jumps to `target` once
   * it has made one; while it hasn't, goes on to make it (§3.4).
   */
  contextConstant(dst: Register, name: string, target: Label, span: AnchoredSpan): void {
    this.#emitJumping({ kind: 'contextConstant', span, dst, name, target: 0 }, target);
  }

  /**
   * Shares into `dst`, a transient's cell register, the cell of a call this one is nested in, of the
   * same function, and jumps to `target`; where none has one, goes on to make it (§3.4).
   */
  transient(dst: Register, target: Label, span: AnchoredSpan): void {
    this.#emitJumping({ kind: 'transient', span, dst, target: 0 }, target);
  }

  /** Emits `instruction`, whose `target` becomes where `target` is placed. */
  #emitJumping(instruction: Extract<WrittenInstruction, { target: number }>, target: Label): void {
    this.emit(instruction);
    this.#refer(target, (position) => {
      instruction.target = position;
    });
  }

  /**
   * Jumps by the variant of the enum value in `value`: to `targets[i]` for variant i, and to
   * `otherwise` for every variant past them.
   */
  switch(value: Register, targets: readonly Label[], span: AnchoredSpan, otherwise?: Label): void {
    const instruction: Extract<WrittenInstruction, { kind: 'switch' }> = {
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

  /** A new wait (proposal 8, Rule 5); its register. */
  wait(span: AnchoredSpan): Register {
    const dst = this.allocate();
    this.emit({ kind: 'wait', span, dst });
    return dst;
  }

  /** A new resolver of the wait in `wait`, for its case `position`; its register. */
  resolver(wait: Register, position: number, span: AnchoredSpan): Register {
    const dst = this.allocate();
    this.emit({ kind: 'resolver', span, dst, wait, position });
    return dst;
  }

  /** Waits until the wait in `wait` is decided, its value then in `dst` (§5). */
  await(dst: Register, wait: Register, span: AnchoredSpan): void {
    this.emit({ kind: 'await', span, dst, wait, ...this.#waypointField() });
  }

  /**
   * Chooses among `cases` as the wait in `wait` is decided (§8): waits for it, or goes to
   * `otherwise` at once when it is undecided.
   */
  select(
    wait: Register,
    cases: readonly SelectCaseCode[],
    otherwise: Label | undefined,
    span: AnchoredSpan,
  ): void {
    const instruction: Extract<WrittenInstruction, { kind: 'select' }> = {
      kind: 'select',
      span,
      wait,
      ...this.#waypointField(),
      cases: cases.map(({ holds, bind }) => ({
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

  /**
   * The code written, at text positions in `tree`, the module of the entry it is for. Throws when a
   * jump names a label nothing placed, a bug in lowering.
   */
  finish(tree: SegmentBases): WrittenCode {
    if (this.#patches.size > 0) {
      const labels = [...this.#patches.keys()].join(', ');
      unreachable(`Labels ${labels} are jumped to but never placed.`);
    }
    // A written instruction differs from its Definition one by its span alone, which the spread
    // replaces; the type system can't follow that through the union.
    const instructions = this.#instructions.map(
      ({ span, ...written }) => ({ ...written, span: spanIn(tree, span) }) as Instruction,
    );
    const counted = Array.from({ length: this.#registers }, (_, register) => register).filter(
      (register) => !this.#plain.has(register),
    );
    return { registers: this.#registers, counted, instructions };
  }

  #waypointField(): { readonly waypoint?: string } {
    return this.#waypoint === undefined ? {} : { waypoint: this.#waypoint };
  }

  /** Sets a label's position into an instruction now, or when the label is placed. */
  #refer(label: Label, patch: (position: number) => void): void {
    const position = this.#placed.get(label.id);
    if (position === undefined) {
      addToGroup(this.#patches, label.id, patch);
    } else {
      patch(position);
    }
  }
}
