/**
 * Where held variables keep what they hold (spec §3.4, §7; docs/arch/definition.md, "Frames").
 *
 * A held variable's block ends many times when it is a loop body, and a register holds one value,
 * so each block end moves what the variable holds into a list (`keep`). The list is a register of
 * its hold scope, which nothing else reads, and it goes when the scope ends, as the scope's other
 * variables do: the function's own list when the function returns, which releases every register.
 * A scope gets its list the first time a hold names it, so code with no hold has none.
 */

import type { Register } from '../../../definition/operands.ts';
import type { CodeWriter } from '../code-writer.ts';
import type { VariableRegisters } from './variables.ts';

/** The lists of one function's hold scopes. */
export class HoldScopes {
  readonly #code: CodeWriter;
  readonly #variables: VariableRegisters;
  #function: Register | undefined;

  constructor(code: CodeWriter, variables: VariableRegisters) {
    this.#code = code;
    this.#variables = variables;
  }

  /** The list of what lasts until the function returns. */
  get functionList(): Register {
    if (this.#function === undefined) {
      this.#function = this.#code.allocate();
      this.#variables.holdUntilReturn(this.#function);
    }
    return this.#function;
  }
}
