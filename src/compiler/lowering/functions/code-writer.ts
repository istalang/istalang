/**
 * Writing one code entry (docs/arch/definition.md, "Frames"): its typed registers, its
 * instructions, the labels its jumps name, and where it ends.
 *
 * - **Every register is typed when allocated,** owning or borrowed, and never reused, so a
 *   register's meaning never changes within an entry and a snapshot reads back plainly.
 * - **One way out.** A `return` moves its value into the entry's result register and jumps to the
 *   epilogue, which lets go of everything still owned and returns it; a stopped execution's `park`
 *   lands on the stop epilogue, which lets go of everything and stops. Both are written once, at
 *   `finish`, when every register is known, so no path can forget one (ir-first design, decision 5).
 *   Letting go of an empty register does nothing, so the epilogues list every owning register.
 * - An instruction is written at the span of the syntax it stands for, and finishing turns every
 *   span into its module's text positions, the one place lowering does.
 * - A jump to a label not yet placed is patched when the label is placed, so code is written in one
 *   pass; finishing refuses a label jumped to and never placed, a bug in lowering.
 */

import type { Instruction } from '../../../definition/instructions/instruction.ts';
import type { Register } from '../../../definition/operands.ts';
import type { RegisterEntry } from '../../../definition/tables/functions.ts';
import type { TypeReference } from '../../../definition/tables/types.ts';
import { addToGroup } from '../../../foundation/structures/groups.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { type AnchoredSpan, type SegmentBases, spanIn } from '../../syntax/tree/positions.ts';

/** A place in the code, known once the code before it has been written. */
export interface Label {
  readonly id: number;
}

/** Where a test goes: to `matched` when it passes, else to `otherwise`. */
export interface Branch {
  readonly matched: Label;
  readonly otherwise: Label;
}

/** An instruction as lowering writes it: at the span of the syntax it stands for. */
export type WrittenInstruction = Instruction extends infer Each
  ? Each extends Instruction
    ? Omit<Each, 'span'> & { readonly span: AnchoredSpan }
    : never
  : never;

type Jumping = Extract<WrittenInstruction, { target: number }>;

const intType: TypeReference = { kind: 'primitive', name: 'Int' };

export const boolType: TypeReference = { kind: 'primitive', name: 'Bool' };

/** A code entry's code as written. */
interface WrittenCode {
  readonly registers: RegisterEntry[];
  readonly instructions: Instruction[];
}

export class CodeWriter {
  readonly #instructions: WrittenInstruction[] = [];
  readonly #registers: RegisterEntry[] = [];
  readonly #placed = new Map<number, number>();
  readonly #patches = new Map<number, ((position: number) => void)[]>();
  #labels = 0;
  readonly #pinned = new Set<Register>();
  readonly #taken = new Set<Register>();
  readonly #transients = new Set<Register>();
  #result: Register | undefined;
  readonly #resultType: TypeReference;
  readonly #epilogue: Label;
  readonly #stopEpilogue: Label;
  #returns: boolean;
  #parks: boolean;

  /** A writer of an entry giving values of `result`. */
  constructor(result: TypeReference) {
    this.#resultType = result;
    this.#epilogue = this.newLabel();
    this.#stopEpilogue = this.newLabel();
    this.#returns = false;
    this.#parks = false;
  }

  /** A fresh register owning values of `type`. */
  allocate(type: TypeReference): Register {
    this.#registers.push({ type, borrowed: false });
    return this.#registers.length - 1;
  }

  /** A fresh register borrowing values of `type`, holding none. */
  borrow(type: TypeReference): Register {
    this.#registers.push({ type, borrowed: true });
    return this.#registers.length - 1;
  }

  /** How many registers are allocated so far. */
  get registerCount(): number {
    return this.#registers.length;
  }

  /** The registers allocated since there were `first`, in order. */
  registersSince(first: number): readonly Register[] {
    return Array.from({ length: this.#registers.length - first }, (_, at) => first + at);
  }

  typeOf(register: Register): TypeReference {
    return this.#registers[register]?.type ?? unreachable(`No register ${register}.`);
  }

  isBorrowed(register: Register): boolean {
    return this.#registers[register]?.borrowed === true;
  }

  emit(instruction: WrittenInstruction): void {
    this.#instructions.push(instruction);
  }

  /** A fresh register owning another holder of `src`'s value. */
  copy(src: Register, span: AnchoredSpan): Register {
    const dst = this.allocate(this.typeOf(src));
    this.emit({ kind: 'copy', span, dst, src });
    return dst;
  }

  /**
   * Notes that `register` is read again after any one use: a variable's, or a value used twice, so
   * taking it copies it (`take`).
   */
  pin(register: Register): void {
    this.#pinned.add(register);
  }

  /**
   * A register owning `src`'s value, for an instruction moving it in: `src` itself, moved out, when
   * it owns a value used once; else a copy. Taking one register twice is a bug in lowering.
   */
  take(src: Register, span: AnchoredSpan): Register {
    if (this.isBorrowed(src) || this.#pinned.has(src)) {
      return this.copy(src, span);
    }
    if (this.#taken.has(src)) {
      unreachable(`Register ${src} is moved out twice.`);
    }
    this.#taken.add(src);
    return src;
  }

  /** Whether `register` holds a transient's cell, which the runtime keeps for its call (§3.4). */
  isTransient(register: Register): boolean {
    return this.#transients.has(register);
  }

  /** Lets go of what `registers` own; borrowed ones and transients' cells own nothing. */
  letGo(registers: readonly Register[], span: AnchoredSpan): void {
    const owning = this.#owningOf(registers);
    if (owning.length > 0) {
      this.emit({ kind: 'letGo', span, registers: owning });
    }
  }

  /** Of `registers`, once each, those a let-go lets go of: none borrowed or a transient's. */
  #owningOf(registers: readonly Register[]): Register[] {
    return [...new Set(registers)].filter(
      (register) => !(this.isBorrowed(register) || this.#transients.has(register)),
    );
  }

  /** A constant of the table, in a fresh register of `type`. */
  constant(constant: number, type: TypeReference, span: AnchoredSpan): Register {
    const dst = this.allocate(type);
    this.emit({ kind: 'constant', span, dst, constant });
    return dst;
  }

  /** Borrows element `index` of the tuple in `src`, of `type`. */
  tupleItem(src: Register, index: number, type: TypeReference, span: AnchoredSpan): Register {
    const dst = this.borrow(type);
    this.emit({ kind: 'tupleItem', span, dst, src, index });
    return dst;
  }

  /** Borrows field `field` of the struct in `src`, of `type`. */
  structField(src: Register, field: number, type: TypeReference, span: AnchoredSpan): Register {
    const dst = this.borrow(type);
    this.emit({ kind: 'structField', span, dst, src, field });
    return dst;
  }

  /** Borrows field `field` of variant `variant` of the enum value in `src`, of `type`. */
  variantField(
    src: Register,
    { variant, field }: { readonly variant: number; readonly field: number },
    type: TypeReference,
    span: AnchoredSpan,
  ): Register {
    const dst = this.borrow(type);
    this.emit({ kind: 'variantField', span, dst, src, variant, field });
    return dst;
  }

  /** Whether the values in `left` and `right` are equal, by the built-in `==`. */
  equal(left: Register, right: Register, span: AnchoredSpan): Register {
    const dst = this.allocate(boolType);
    this.emit({ kind: 'equal', span, dst, left, right });
    return dst;
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
   * Another holder of the instance's value of the context constant `name` into `dst`, and a jump to
   * `target` once it has made one; while it hasn't, on to make it (§3.4).
   */
  contextConstant(dst: Register, name: string, target: Label, span: AnchoredSpan): void {
    this.#emitJumping({ kind: 'contextConstant', span, dst, name, target: 0 }, target);
  }

  /**
   * Borrows into `dst`, a transient's cell register, the cell of a call this one is nested in, of
   * the same function, and jumps to `target`; where none has one, on to make it (§3.4).
   */
  transient(dst: Register, target: Label, span: AnchoredSpan): void {
    this.#transients.add(dst);
    this.#emitJumping({ kind: 'transient', span, dst, target: 0 }, target);
  }

  /**
   * Where a function is bound to the entry's slot (§10): what it gives for the parameters, of
   * `given`, in a fresh register, which `answered` makes the entry's result, returned through the
   * epilogue; else on to the body.
   */
  rebound(
    span: AnchoredSpan,
    { passed, given }: { readonly passed: readonly Register[]; readonly given: TypeReference },
    answered: (dst: Register) => Register,
  ): void {
    const dst = this.allocate(given);
    const landing = this.newLabel();
    const body = this.newLabel();
    const instruction: Extract<WrittenInstruction, { kind: 'rebound' }> = {
      kind: 'rebound',
      span,
      dst,
      arguments: [...passed],
      landing: 0,
    };
    this.emit(instruction);
    this.#refer(landing, (position) => {
      instruction.landing = position;
    });
    this.jump(body, span);
    this.place(landing);
    this.return(answered(dst), span);
    this.place(body);
  }

  /** Jumps by the variant of the enum value in `value`: `targets[i]` for variant i (§3.15). */
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

  /**
   * Parks the running execution (§5); the position the wait was decided for, once unparked. A stop
   * lands on the stop epilogue.
   */
  park(waypoint: string | undefined, span: AnchoredSpan): Register {
    this.#parks = true;
    const dst = this.allocate(intType);
    const instruction: Extract<WrittenInstruction, { kind: 'park' }> = {
      kind: 'park',
      span,
      dst,
      stop: 0,
      ...(waypoint === undefined ? {} : { waypoint }),
    };
    this.emit(instruction);
    this.#refer(this.#stopEpilogue, (position) => {
      instruction.stop = position;
    });
    return dst;
  }

  /** Returns `value`'s value from the entry, through its epilogue. */
  return(value: Register, span: AnchoredSpan): void {
    this.#returns = true;
    this.#result ??= this.allocate(this.#resultType);
    this.emit({ kind: 'move', span, dst: this.#result, src: this.take(value, span) });
    this.jump(this.#epilogue, span);
  }

  /**
   * The code written, at text positions in `tree`, the module of the entry, its epilogues placed
   * at `span`. Throws when a jump names a label nothing placed, a bug in lowering.
   */
  finish(tree: SegmentBases, span: AnchoredSpan): WrittenCode {
    const owning = () =>
      this.#registers.flatMap((entry, register) =>
        entry.borrowed || register === this.#result ? [] : [register],
      );
    if (this.#returns && this.#result !== undefined) {
      this.place(this.#epilogue);
      this.emit({
        kind: 'return',
        span,
        value: this.#result,
        releasing: this.#owningOf(owning()),
      });
    }
    if (this.#parks) {
      this.place(this.#stopEpilogue);
      this.letGo(this.#result === undefined ? owning() : [...owning(), this.#result], span);
      this.emit({ kind: 'stopped', span });
    }
    if (this.#patches.size > 0) {
      const labels = [...this.#patches.keys()].join(', ');
      unreachable(`Labels ${labels} are jumped to but never placed.`);
    }
    // A written instruction differs from its Definition one by its span alone, which the spread
    // replaces; the type system can't follow that through the union.
    const instructions = this.#instructions.map(
      ({ span: written, ...rest }) => ({ ...rest, span: spanIn(tree, written) }) as Instruction,
    );
    return { registers: this.#registers, instructions };
  }

  /** Emits `instruction`, whose `target` becomes where `target` is placed. */
  #emitJumping(instruction: Jumping, target: Label): void {
    this.emit(instruction);
    this.#refer(target, (position) => {
      instruction.target = position;
    });
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
