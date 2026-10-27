/**
 * The loops and labelled blocks around what one function checks (§3.4, §4): a function's own, since
 * neither `break`, `continue` nor a label ever leaves the function it is written in
 * (function-scope.ts). It counts which labels were named, so an unused one is known when its scope
 * ends.
 */

import { withPushed } from '../../../structures/stack.ts';
import { type LabelledScope, scopeLabelled } from '../../syntax/labels.ts';
import type { Identifier } from '../../syntax/node.ts';

/** The scopes whose bodies are being checked, innermost last, and the function's own name. */
export class EnclosingScopes {
  readonly #scopes: LabelledScope[] = [];
  readonly #named = new Set<LabelledScope>();
  readonly #ownName: Identifier | undefined;

  constructor(ownName: Identifier | undefined) {
    this.#ownName = ownName;
  }

  /** Runs `check` inside the body of `scope`; what it gave, and whether `scope` was named meanwhile. */
  inside<Result>(
    scope: LabelledScope,
    check: () => Result,
  ): { readonly result: Result; readonly named: boolean } {
    const result = withPushed(this.#scopes, scope, check);
    return { result, named: this.#named.has(scope) };
  }

  /** Whether a loop encloses what is checked: where `break` and `continue` may stand. */
  get inLoop(): boolean {
    return this.#scopes.some((scope) => scope.kind !== 'LabelledBlock');
  }

  /** The enclosing scope labelled `name`, without counting it named: a new label repeating it. */
  labelled(name: Identifier): LabelledScope | undefined {
    return scopeLabelled(this.#scopes, (scope) => scope.label, name);
  }

  /** The enclosing scope labelled `name`, now counted named; undefined when none is. */
  name(label: Identifier): LabelledScope | undefined {
    const scope = this.labelled(label);
    if (scope !== undefined) {
      this.#named.add(scope);
    }
    return scope;
  }

  /** Whether `name` is the function's own, which `hold(name)` also names. */
  isOwnName(name: Identifier): boolean {
    return this.#ownName?.text === name.text;
  }
}
