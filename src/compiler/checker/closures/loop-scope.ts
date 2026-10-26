/**
 * The loops of one function being checked (§4): a function's own, since `break` and `continue`
 * never leave the function they are written in (function-scope.ts).
 */

import { withPushed } from '../../../structures/stack.ts';
import type { For, While } from '../../syntax/statements.ts';

/** The loops whose bodies are being checked, innermost last: where `break` and `continue` may stand. */
export class LoopScope {
  readonly #loops: (While | For)[] = [];

  /** Runs `check` inside the body of `loop`. */
  inside<Result>(loop: While | For, check: () => Result): Result {
    return withPushed(this.#loops, loop, check);
  }

  get active(): boolean {
    return this.#loops.length > 0;
  }
}
