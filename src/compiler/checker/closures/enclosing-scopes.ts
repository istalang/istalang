/**
 * The loops and labelled blocks around what one function checks (§3.4, §4): a function's own, since
 * neither `break`, `continue` nor a label ever leaves the function it is written in
 * (function-scope.ts). Labels are resolved against it once, by statements/loops.ts.
 */

import { withPushed } from '../../../structures/stack.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { LabelledScope, Loop } from '../../syntax/statements.ts';
import type { Enclosing } from '../body-context.ts';

/** The scopes whose bodies are being checked, innermost last, and the function's own name. */
export class EnclosingScopes implements Enclosing {
  readonly #scopes: LabelledScope[] = [];
  readonly #ownName: Identifier | undefined;

  constructor(ownName: Identifier | undefined) {
    this.#ownName = ownName;
  }

  inside<Result>(scope: LabelledScope, check: () => Result): Result {
    return withPushed(this.#scopes, scope, check);
  }

  get innermostLoop(): Loop | undefined {
    return this.#scopes.findLast((scope): scope is Loop => scope.kind !== 'LabelledBlock');
  }

  labelled(name: Identifier): LabelledScope | undefined {
    return this.#scopes.findLast((scope) => scope.label?.text === name.text);
  }

  isOwnName(name: Identifier): boolean {
    return this.#ownName?.text === name.text;
  }
}
