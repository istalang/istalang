/**
 * Where held variables keep what they hold (spec §3.4, §7; docs/arch/definition.md, "Frames").
 *
 * A held variable's block ends many times when it is a loop body, and a register holds one value,
 * so each block end moves what the variable holds into a list (`keep`). The list is a register of
 * its hold scope, which nothing else reads, and it goes when the scope ends, as the scope's other
 * variables do:
 * - the function's own list, for `hold` and `hold(f)` naming the function, when the function
 *   returns, which releases every register; it is made the first time a hold names it;
 * - a labelled loop's or block's, for `hold(name)`, as a variable of a block around the scope, so
 *   every way out of the scope releases it, `continue` aside. Only a scope some hold names gets one
 *   (syntax `isHoldScope`), decided before its body is lowered, since a `break` out of it may be
 *   lowered before the first hold.
 */

import type { Register } from '../../../definition/operands.ts';
import { withPushed } from '../../../structures/stack.ts';
import { isHoldScope, type LabelledScope, scopeLabelled } from '../../syntax/labels.ts';
import type { Hold } from '../../syntax/statements.ts';
import type { CodeWriter } from '../code-writer.ts';
import type { FunctionContext } from '../context.ts';
import { endScope } from './scopes.ts';
import type { VariableRegisters } from './variables.ts';

/** A labelled scope some hold names, and its list. */
interface HoldScope {
  readonly scope: LabelledScope;
  readonly list: Register;
}

/** The lists of one function's hold scopes. */
export class HoldScopes {
  readonly #code: CodeWriter;
  readonly #variables: VariableRegisters;
  readonly #labelled: HoldScope[] = [];
  #function: Register | undefined;

  constructor(code: CodeWriter, variables: VariableRegisters) {
    this.#code = code;
    this.#variables = variables;
  }

  /** The list `hold` keeps into: the labelled scope's it names, else the function's. */
  listOf(hold: Hold): Register {
    const named =
      hold.label === undefined
        ? undefined
        : scopeLabelled(this.#labelled, ({ scope }) => scope.label, hold.label);
    return named?.list ?? this.#functionList();
  }

  /** Runs `lower` inside `scope`, whose list is `list`. */
  inside(scope: LabelledScope, list: Register, lower: () => void): void {
    withPushed(this.#labelled, { scope, list }, lower);
  }

  #functionList(): Register {
    if (this.#function === undefined) {
      this.#function = this.#code.allocate();
      this.#variables.holdUntilReturn(this.#function);
    }
    return this.#function;
  }
}

/** Lowers `scope` with `lower`, inside a block holding its list when some hold names it. */
export function lowerHoldScope(
  context: FunctionContext,
  scope: LabelledScope,
  lower: () => void,
): void {
  if (!isHoldScope(scope)) {
    lower();
    return;
  }
  const { scope: around } = context.variables.inBlock(() => {
    const list = context.code.allocate();
    context.variables.hold(list);
    context.holds.inside(scope, list, lower);
  });
  endScope(context, around, scope.span);
}
