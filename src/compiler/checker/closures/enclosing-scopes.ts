/**
 * The loops and labelled blocks around what one function checks (§3.4, §4): a function's own, since
 * neither `break`, `continue` nor a label ever leaves the function it is written in
 * (function-scope.ts). Labels are resolved against it once, by statements/loops.ts.
 */

import { withPushed } from '../../../structures/stack.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { For, LabelledScope, While } from '../../syntax/statements.ts';

/** The scopes whose bodies are being checked, innermost last, and the function's own name. */
export class EnclosingScopes {
  readonly #scopes: LabelledScope[] = [];
  readonly #ownName: Identifier | undefined;

  constructor(ownName: Identifier | undefined) {
    this.#ownName = ownName;
  }

  /** Runs `check` inside the body of `scope`. */
  inside<Result>(scope: LabelledScope, check: () => Result): Result {
    return withPushed(this.#scopes, scope, check);
  }

  /** The innermost loop around: what a `break` or `continue` with no label leaves. */
  get innermostLoop(): For | While | undefined {
    return this.#scopes.findLast((scope) => scope.kind !== 'LabelledBlock');
  }

  /** The innermost scope around labelled `name`. */
  labelled(name: Identifier): LabelledScope | undefined {
    return this.#scopes.findLast((scope) => scope.label?.text === name.text);
  }

  /** Whether `name` is the function's own, which `hold(name)` also names. */
  isOwnName(name: Identifier): boolean {
    return this.#ownName?.text === name.text;
  }
}
