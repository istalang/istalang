/**
 * What a flow releases where (§3.4, §7), as lowering releases it (lowering/constructs/statements/
 * scopes.ts, holds.ts): a scope's variables where it ends and on every path leaving it early, a
 * `hold(name)`'s where the scope it names ends, however it ends, and `break` and `continue` going
 * where the scope they name says.
 *
 * - A scope is a block, a loop's pass, a case or a guarded body, whose header (a condition, a
 *   pattern) binds into it; the variables `hold`s keep until a labelled scope ends are a scope of
 *   their own (`holder`), outside its passes, so its `continue` leaves them alone.
 * - A variable is declared once per scope, however many paths bind it (an `or` pattern's).
 */

import type { LabelledScope } from '../../../../syntax/statements/index.ts';
import type { SyntaxNode } from '../../../../syntax/tree/index.ts';
import type { BlockId, Exit, Operation, ValueId } from '../flow-ir.ts';

/** What releasing needs of the flow being built: adding operations and ending blocks. */
interface Releasing {
  readonly emit: (operation: Operation) => void;
  readonly end: (exit: Exit) => void;
  /** Puts `operation` first in `block`, which nothing has been built in yet. */
  readonly prepend: (block: BlockId, operation: Operation) => void;
}

interface Scope {
  readonly node: SyntaxNode;
  readonly holder?: LabelledScope;
  readonly variables: ValueId[];
}

/** Where an exit naming `scope` goes: past its end, or, for a loop, to its next pass. */
interface ExitTarget {
  readonly scope: LabelledScope;
  readonly breakTo: BlockId;
  readonly continueTo: BlockId | undefined;
  /** How many scopes were open outside it, which its exits never release. */
  readonly depth: number;
}

export class Scopes {
  readonly #flow: Releasing;
  readonly #scopes: Scope[] = [];
  readonly #exits: ExitTarget[] = [];

  constructor(flow: Releasing) {
    this.#flow = flow;
  }

  /** Runs `build` in a scope of `node`'s, releasing its variables where `build` ends. */
  inScope<Result>(node: SyntaxNode, build: () => Result): Result {
    this.#scopes.push({ node, variables: [] });
    const result = build();
    const scope = this.#scopes.pop() as Scope;
    this.#release(scope.variables, scope.node);
    return result;
  }

  /** Releases what the innermost scope declared so far, on a path leaving it early. */
  leave(site: SyntaxNode): void {
    this.#release(this.#scopes.at(-1)?.variables ?? [], site);
  }

  /** `variable`, declared in the innermost scope, or held until `until` ends (§7). */
  declare(variable: ValueId, until?: LabelledScope | 'function'): void {
    if (until === 'function') {
      return;
    }
    const scope =
      until === undefined
        ? this.#scopes.at(-1)
        : this.#scopes.findLast((each) => each.holder === until);
    if (scope !== undefined && !scope.variables.includes(variable)) {
      scope.variables.push(variable);
    }
  }

  /**
   * Runs `build` with `scope`'s exits going to `breakTo` and `continueTo`; what `hold`s keep until
   * it ends is released where it is left: at `breakTo`, which nothing has been built in yet.
   */
  withExits<Result>(
    scope: LabelledScope,
    breakTo: BlockId,
    continueTo: BlockId | undefined,
    build: () => Result,
  ): Result {
    const depth = this.#scopes.length;
    this.#scopes.push({ node: scope, holder: scope, variables: [] });
    this.#exits.push({ scope, breakTo, continueTo, depth });
    const result = build();
    this.#exits.pop();
    const held = this.#scopes.pop() as Scope;
    if (held.variables.length > 0) {
      this.#flow.prepend(breakTo, released(held.variables, scope));
    }
    return result;
  }

  /**
   * An exit from `scope`: releases every scope inside it that it leaves, then goes past it, where
   * what `hold`s keep until it ends is released, or to its next pass, which keeps them.
   */
  exit(scope: LabelledScope | undefined, kind: 'break' | 'continue', site: SyntaxNode): void {
    const target = this.#exits.findLast((each) => each.scope === scope);
    if (target === undefined) {
      this.#flow.end({ kind: 'stop' });
      return;
    }
    for (const left of this.#scopes.slice(target.depth + 1).toReversed()) {
      this.#release(left.variables, site);
    }
    const to = kind === 'break' ? target.breakTo : target.continueTo;
    this.#flow.end(to === undefined ? { kind: 'stop' } : { kind: 'goto', to });
  }

  #release(variables: readonly ValueId[], site: SyntaxNode): void {
    if (variables.length > 0) {
      this.#flow.emit(released(variables, site));
    }
  }
}

function released(variables: readonly ValueId[], site: SyntaxNode): Operation {
  return { op: 'release', site, values: [...variables], reason: 'scope' };
}
