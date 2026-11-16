/**
 * The variables of one entry (§3.4, §3.15; docs/arch/definition.md, "Frames"): each name it
 * declares lives in a register of its own, whichever flow of the entry writes it, its frame's
 * parameters and captures first. What a variable holds is released where its flow says
 * (writer.ts).
 *
 * A variable passed by `&` somewhere in the body, or a `let` a closure captures, lives in a cell,
 * which a reference or a closure can reach: its register is listed in the entry's `cells`, typed as
 * the `_Cell<T>` the cell is created as.
 */

import type { Register, TypeId } from '../../../definition/operands.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { substitute } from '../../checker/types/parts/substitution.ts';
import type { Type } from '../../checker/types/type/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import type { FunctionContext } from '../context.ts';

/** A register holding a cell, and the `_Cell<T>` type entry it is created as. */
export interface CellRegister {
  readonly register: Register;
  readonly type: TypeId;
}

/** The register each variable of one entry lives in, by its declaring name, and its cells. */
export class VariableRegisters {
  readonly #registers = new Map<Identifier, Register>();
  readonly #variables = new Set<Register>();
  readonly #cells: CellRegister[] = [];

  declare(declaring: Identifier, register: Register): void {
    this.#registers.set(declaring, register);
    this.#variables.add(register);
  }

  /** Whether a variable lives in `register`. */
  isVariable(register: Register): boolean {
    return this.#variables.has(register);
  }

  has(declaring: Identifier): boolean {
    return this.#registers.has(declaring);
  }

  registerOf(declaring: Identifier): Register {
    return (
      this.#registers.get(declaring) ??
      unreachable(`'${declaring.text}' has no register; the checker let an unknown name by.`)
    );
  }

  addCell(cell: CellRegister): void {
    this.#cells.push(cell);
  }

  /** Whether `register` holds a cell. */
  isCell(register: Register): boolean {
    return this.#cells.some((cell) => cell.register === register);
  }

  /** The cell register `register` is made as the cell entry `type`, in place of the one it had. */
  remakeCell(register: Register, type: TypeId): void {
    const at = this.#cells.findIndex((cell) => cell.register === register);
    this.#cells.splice(at, 1, { register, type });
  }

  get cells(): readonly CellRegister[] {
    return this.#cells;
  }
}

/** A fresh register listed as a cell holding a `type`, created as its `_Cell<T>` entry. */
export function cellRegister(context: FunctionContext, type: Type): Register {
  const register = context.code.allocate();
  const cellType = context.checker.cellOf(type);
  context.variables.addCell({ register, type: context.tables.types.index(cellType) });
  holdsType(context, register, cellType);
  return register;
}

/**
 * Notes that the cell register `register` holds a value of `type`, as another pass of a field loop
 * may (§4): when that reaches a disposable, its cell is made as `type`'s, which both runtimes count.
 */
export function cellHolds(context: FunctionContext, register: Register, type: Type): void {
  const cellType = context.checker.cellOf(concreteType(context, type));
  holdsType(context, register, cellType);
  if (context.checker.reachesDisposable(cellType)) {
    context.variables.remakeCell(register, context.tables.types.index(cellType));
  }
}

/**
 * Notes that `register` holds values of `type`, read as the entry reads it where it is written, in
 * the pass of a field loop it is in (§4): plain when no type it holds reaches a disposable
 * (CodeWriter `holdsPlain`, `holdsCounted`).
 */
export function holdsType(context: FunctionContext, register: Register, type: Type): void {
  if (context.checker.reachesDisposable(concreteType(context, type))) {
    context.code.holdsCounted(register);
  } else {
    context.code.holdsPlain(register);
  }
}

/** `type` as the entry's body reads it now: its type parameters and field loops' keys substituted. */
export function concreteType(context: FunctionContext, type: Type): Type {
  return substitute(type, context.body.substitution, context.checker.typeRules);
}
