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
 *   every way out of the scope releases it, `continue` aside. Only a scope the checker found a hold
 *   naming gets one (CheckedBody `labels`), decided before its body is lowered, since a `break` out
 *   of it may be lowered before the first hold.
 */

import type { Register } from '../../../definition/operands.ts';
import { withPushed } from '../../../structures/stack.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Hold, LabelledScope } from '../../syntax/statements.ts';
import type { FunctionContext } from '../context.ts';
import { endScope } from './scopes.ts';

/** A labelled scope some hold names, and its list. */
interface HoldScope {
  readonly scope: LabelledScope;
  readonly list: Register;
}

/** The lists of one function's hold scopes. */
export class HoldScopes {
  readonly #context: FunctionContext;
  readonly #labelled: HoldScope[] = [];
  #function: Register | undefined;

  constructor(context: FunctionContext) {
    this.#context = context;
  }

  /** The list `hold` keeps into: the labelled scope's the checker found it naming, or the function's. */
  listOf(hold: Hold): Register {
    const scope = this.#context.body.labels.heldUntil(hold);
    if (scope === undefined) {
      return this.#functionList();
    }
    const named = this.#labelled.findLast((each) => each.scope === scope);
    if (named === undefined) {
      unreachable(`A hold at ${hold.span.start} names a scope not being lowered.`);
    }
    return named.list;
  }

  /** Lowers `scope` with `lower`, inside a block holding its list when some hold names it. */
  lowerScope(scope: LabelledScope, lower: () => void): void {
    const context = this.#context;
    if (!context.body.labels.isHoldScope(scope)) {
      lower();
      return;
    }
    const { scope: around } = context.variables.inBlock(() => {
      const list = context.code.allocate();
      context.variables.declareUnnamed(list);
      withPushed(this.#labelled, { scope, list }, lower);
    });
    endScope(context, around, scope.span);
  }

  #functionList(): Register {
    if (this.#function === undefined) {
      this.#function = this.#context.code.allocate();
      this.#context.variables.declareFunctionWide(this.#function);
    }
    return this.#function;
  }
}
