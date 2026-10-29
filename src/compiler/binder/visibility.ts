/**
 * Which names a module's scopes make visible at each offset (§3.4), kept from binding for tools: an
 * editor offers the names visible where the cursor is, and only those.
 *
 * Binding notes, for each node it binds, the scope it binds that node in, as defined at that
 * moment. The scope rules are therefore the binder's alone (flow.ts, statements.ts and the rest),
 * not restated here: what is visible at an offset is what a lookup found while binding the
 * innermost noted node there, so a name declared later in a block, an `is` binding outside the
 * region it flows into, or a pattern's own bindings inside the pattern are never visible.
 *
 * A note may start later than its node: a construct that makes a scope notes it from where its
 * names become visible (a function after each parameter, a case after its pattern, a block after
 * each statement), so a spot no inner node holds, such as a blank line or a missing expression,
 * sees what a name written there would. A node whose notes all start past the offset defers to
 * the node around it, and outside every noted node, such as between top-level declarations, the
 * module's top level is visible.
 *
 * A node that stands for missing code, such as a default not yet written after `=`, holds no
 * offset: it is empty, and so are the nodes around it past their last token. A cursor on the
 * blank stretch of line after it is where that code goes, so it sees what the empty node was bound
 * in.
 */

import { nodesAt, type SyntaxNode, type SyntaxTree } from '../syntax/tree.ts';
import { type LocalEntity, Scope, type ScopeSnapshot } from './scope.ts';

/** A scope state, noted for a node from an offset on. */
interface NotedSnapshot {
  readonly from: number;
  readonly snapshot: ScopeSnapshot;
}

/** The names a module's scopes make visible, by position. */
export interface Visibility {
  /**
   * What a lookup at `offset` of the bound `tree` finds for each name. Named imports are still
   * their placeholders.
   */
  readonly namesAt: (tree: SyntaxTree, offset: number) => ReadonlyMap<string, LocalEntity>;
}

/** Spaces and tabs alone: a stretch of one line with nothing written on it. */
const blankStretch = /^[ \t]*$/u;

/** Notes, while one tree is bound, the scope each node is bound in. */
export class VisibilityNotes {
  readonly #noted = new Map<SyntaxNode, NotedSnapshot[]>();
  /** The notes of empty nodes, from their position on. */
  readonly #empty: NotedSnapshot[] = [];

  /** Notes that `node`, from `from` on, is bound in `scope` as it is defined now. */
  note(node: SyntaxNode, scope: Scope, from = node.span.start): void {
    const noted = this.#noted.get(node) ?? [];
    const note = { from, snapshot: scope.snapshot() };
    noted.push(note);
    this.#noted.set(node, noted);
    if (node.span.start === node.span.end) {
      this.#empty.push(note);
    }
  }

  /** The visibility the notes give, with `topLevel` outside every noted node. */
  visibility(topLevel: ScopeSnapshot): Visibility {
    const noted = this.#noted;
    const empty = this.#empty;
    return {
      namesAt: (tree, offset) => {
        const isBlankUpTo = ({ from }: NotedSnapshot) =>
          blankStretch.test(tree.source.text.slice(from, offset));
        const missing = latestStarted(empty.filter(isBlankUpTo), offset);
        const started = (node: SyntaxNode) => latestStarted(noted.get(node) ?? [], offset);
        const found =
          missing ??
          nodesAt(tree, offset)
            .toReversed()
            .map(started)
            .find((each) => each !== undefined);
        return Scope.visibleIn(found?.snapshot ?? topLevel);
      },
    };
  }
}

/** Of `notes`, the one started last by `offset`; of two starting together, the later noted. */
function latestStarted(notes: readonly NotedSnapshot[], offset: number): NotedSnapshot | undefined {
  return notes.reduce<NotedSnapshot | undefined>(
    (latest, note) =>
      note.from <= offset && (latest === undefined || note.from >= latest.from) ? note : latest,
    undefined,
  );
}
