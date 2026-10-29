/**
 * Which names a module's scopes make visible at each offset (§3.4), kept from binding for tools: an
 * editor offers the names visible where the cursor is, and only those.
 *
 * Binding notes, for each node it binds, the scope it binds that node in, as defined at that
 * moment. The scope rules are therefore the binder's alone (flow.ts, statements.ts and the rest),
 * not restated here: what is visible at an offset is what a lookup found while binding the
 * innermost noted node there, so a name declared later in a block, an `is` binding outside the
 * region it flows into, or a pattern's own bindings inside the pattern are never visible. A block
 * is noted again after each statement, so a blank line sees what the statements above it declared.
 * Outside every noted node, such as between top-level declarations, the module's top level is.
 */

import type { SyntaxNode } from '../syntax/tree.ts';
import { type LocalEntity, Scope, type ScopeSnapshot } from './scope.ts';

/** A scope state, noted for a node from an offset on. */
interface NotedSnapshot {
  readonly from: number;
  readonly snapshot: ScopeSnapshot;
}

/** The names a module's scopes make visible, by position. */
export interface Visibility {
  /**
   * What a lookup at `offset` finds for each name, given the nodes holding the offset from the root
   * to the innermost (syntax/tree.ts `nodesAt`). Named imports are still their placeholders.
   */
  readonly namesAt: (
    path: readonly SyntaxNode[],
    offset: number,
  ) => ReadonlyMap<string, LocalEntity>;
}

/** Notes, while one tree is bound, the scope each node is bound in. */
export class VisibilityNotes {
  readonly #noted = new Map<SyntaxNode, NotedSnapshot[]>();

  /** Notes that `node`, from `from` on, is bound in `scope` as it is defined now. */
  note(node: SyntaxNode, scope: Scope, from = node.span.start): void {
    const noted = this.#noted.get(node) ?? [];
    noted.push({ from, snapshot: scope.snapshot() });
    this.#noted.set(node, noted);
  }

  /** The visibility the notes give, with `topLevel` outside every noted node. */
  visibility(topLevel: ScopeSnapshot): Visibility {
    const noted = this.#noted;
    return {
      namesAt: (path, offset) => {
        const innermost = path.findLast((node) => noted.has(node));
        const notes = innermost === undefined ? [] : (noted.get(innermost) ?? []);
        const note = notes.findLast(({ from }) => from <= offset);
        return Scope.visibleIn(note?.snapshot ?? topLevel);
      },
    };
  }
}
