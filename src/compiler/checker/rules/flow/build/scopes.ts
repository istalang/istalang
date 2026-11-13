/**
 * What a flow releases where (§3.4, §7), as lowering releases it (lowering/constructs/statements/
 * scopes.ts, holds.ts): a scope's variables where it ends and on every path leaving it early, what
 * a `hold` keeps kept there first and released where the scope it names ends, however it ends,
 * `break` and `continue` going where the scope they name says; and a construct's temporaries where
 * it says, each once (`claim`): a statement's at its end, a header's on each path out of it.
 *
 * - A scope is a block, a loop's pass, a case or a guarded body, whose header (a condition, a
 *   pattern) binds into it; the variables `hold`s keep until a labelled scope ends are a scope of
 *   their own (`holder`), outside its passes, so its `continue` leaves them alone.
 * - A variable is declared once per scope, however many paths bind it (an `or` pattern's).
 */

import type { LabelledScope } from '../../../../syntax/statements/index.ts';
import type { SyntaxNode } from '../../../../syntax/tree/index.ts';
import type { BlockId, Exit, Operation, ValueId } from '../../../surface/flow-ir.ts';

/** What releasing needs of the flow being built: adding operations and ending blocks. */
interface Releasing {
  readonly emit: (operation: Operation) => void;
  readonly end: (exit: Exit) => void;
  /** Puts `operation` first in `block`, which nothing has been built in yet. */
  readonly prepend: (block: BlockId, operation: Operation) => void;
}

/** Where what a `hold` keeps lasts until: a labelled scope's end, or the function's (§7). */
type HeldUntil = LabelledScope | 'function';

interface Scope {
  readonly node: SyntaxNode;
  readonly holder?: LabelledScope;
  readonly variables: ValueId[];
  /** Its variables `hold`s keep longer, each kept where the scope ends, before it releases them. */
  readonly kept: { readonly value: ValueId; readonly until: HeldUntil }[];
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
  /** Values some scope releases, and temporaries released already: none is released again. */
  readonly #owned = new Set<ValueId>();

  constructor(flow: Releasing) {
    this.#flow = flow;
  }

  /** Runs `build` in a scope of `node`'s, ending it where `build` ends. */
  inScope<Result>(node: SyntaxNode, build: () => Result): Result {
    this.#scopes.push({ node, variables: [], kept: [] });
    const result = build();
    const scope = this.#scopes.pop() as Scope;
    this.#end(scope, scope.node);
    return result;
  }

  /**
   * Ends what the innermost scope declared so far, on a path leaving it early, releasing `also`, a
   * header's temporaries, with its variables.
   */
  leave(site: SyntaxNode, also: readonly ValueId[] = []): void {
    const scope = this.#scopes.at(-1);
    if (scope !== undefined) {
      this.#end(scope, site, also);
    }
  }

  /**
   * `variable`, declared in the innermost scope, or held until `until` ends (§7): kept where the
   * innermost scope ends, released where `until` does, or by the function's return.
   */
  declare(variable: ValueId, until?: HeldUntil): void {
    this.#owned.add(variable);
    const innermost = this.#scopes.at(-1);
    if (until !== undefined) {
      innermost?.kept.push({ value: variable, until });
    }
    if (until === 'function') {
      return;
    }
    const scope =
      until === undefined ? innermost : this.#scopes.findLast((each) => each.holder === until);
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
    this.#scopes.push({ node: scope, holder: scope, variables: [], kept: [] });
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
   * An exit from `scope`: ends every scope inside it that it leaves, then goes past it, where what
   * `hold`s keep until it ends is released, or to its next pass, which keeps them.
   */
  exit(scope: LabelledScope | undefined, kind: 'break' | 'continue', site: SyntaxNode): void {
    const target = this.#exits.findLast((each) => each.scope === scope);
    if (target === undefined) {
      this.#flow.end({ kind: 'stop' });
      return;
    }
    for (const left of this.#scopes.slice(target.depth + 1).toReversed()) {
      this.#end(left, site);
    }
    const to = kind === 'break' ? target.breakTo : target.continueTo;
    this.#flow.end(to === undefined ? { kind: 'stop' } : { kind: 'goto', to });
  }

  /**
   * Of `values`, the temporaries a construct computed, those no scope releases and nothing has
   * released yet, now released where the construct releases them, each once.
   */
  claim(values: readonly ValueId[]): readonly ValueId[] {
    const claimed = values.filter((value) => !this.#owned.has(value));
    for (const value of claimed) {
      this.#owned.add(value);
    }
    return claimed;
  }

  /** Releases `values` at `site`, if there are any. */
  release(values: readonly ValueId[], site: SyntaxNode): void {
    if (values.length > 0) {
      this.#flow.emit(released(values, site));
    }
  }

  /** `scope` ended at `site`: what its `hold`s keep is kept, then its variables are released. */
  #end(scope: Scope, site: SyntaxNode, also: readonly ValueId[] = []): void {
    for (const [until, kept] of Map.groupBy(scope.kept, (each) => each.until)) {
      this.#flow.emit({ op: 'keep', site, values: kept.map(({ value }) => value), until });
    }
    this.release([...scope.variables, ...also], site);
  }
}

function released(values: readonly ValueId[], site: SyntaxNode): Operation {
  return { op: 'release', site, values: [...values], reason: 'end' };
}
