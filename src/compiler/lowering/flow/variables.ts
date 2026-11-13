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
import type { Type } from '../../checker/types/type/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import type { CodeContext } from '../context.ts';

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

  get cells(): readonly CellRegister[] {
    return this.#cells;
  }
}

/** A fresh register listed as a cell holding a `type`, created as its `_Cell<T>` entry. */
export function cellRegister(
  context: CodeContext & { readonly variables: VariableRegisters },
  type: Type,
): Register {
  const register = context.code.allocate();
  const cell = context.tables.types.index(context.checker.cellOf(type));
  context.variables.addCell({ register, type: cell });
  return register;
}
