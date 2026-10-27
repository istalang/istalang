/**
 * What each `break`, `continue` and `hold(name)` of one body names (§3.4, §4): where control goes
 * and how long holdings last. Resolved once by the checker while the scopes around it are open
 * (statements/loops.ts); the flow model and lowering read it by node, so no other walk finds a
 * label again.
 */

import type { Break, Continue, Hold, LabelledScope } from '../../syntax/statements.ts';

/** What one body's exits and holds name, as lowering and the flow model read it. */
export interface LabelResolution {
  /** The scope `exit` leaves or goes on with; undefined where the checker found none. */
  readonly exitOf: (exit: Break | Continue) => LabelledScope | undefined;
  /** The labelled loop or block what `hold` holds lasts until; undefined for the function. */
  readonly heldUntil: (hold: Hold) => LabelledScope | undefined;
  /** Whether some `hold` names `scope`, which then keeps a list of what it holds. */
  readonly isHoldScope: (scope: LabelledScope) => boolean;
}

/** The exits and holds of one body, recorded as the checker resolves them. */
export class LabelTargets implements LabelResolution {
  readonly #exits = new Map<Break | Continue, LabelledScope>();
  readonly #holds = new Map<Hold, LabelledScope>();
  readonly #named = new Set<LabelledScope>();
  readonly #holdScopes = new Set<LabelledScope>();

  recordExit(exit: Break | Continue, target: LabelledScope): void {
    this.#exits.set(exit, target);
    if (exit.label !== undefined) {
      this.#named.add(target);
    }
  }

  recordHold(hold: Hold, target: LabelledScope): void {
    this.#holds.set(hold, target);
    this.#named.add(target);
    this.#holdScopes.add(target);
  }

  /** Whether some exit or hold names `scope` by its label. */
  isNamed(scope: LabelledScope): boolean {
    return this.#named.has(scope);
  }

  exitOf(exit: Break | Continue): LabelledScope | undefined {
    return this.#exits.get(exit);
  }

  heldUntil(hold: Hold): LabelledScope | undefined {
    return this.#holds.get(hold);
  }

  isHoldScope(scope: LabelledScope): boolean {
    return this.#holdScopes.has(scope);
  }
}
