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
 * offset: it is empty, and so are the nodes around it past their last token, a block past its last
 * statement among them. Code written after such a node, or after a block's last statement, with
 * nothing but blanks and comments between, still goes there: on the same line, or on a later line
 * indented deeper than the line its construct starts on, as a body's lines stand below their
 * header (§2). So a cursor there sees what that node or that block's end was bound in. Of those
 * standing together, the code goes into the first noted: the innermost block, or a `for`'s
 * iterable before its body.
 */

import { lineStartAt } from '../../text/line-map.ts';
import { type AnchoredSpan, spanIn } from '../syntax/positions.ts';
import { nodesAt, parentOf, type SyntaxNode, type SyntaxTree } from '../syntax/tree.ts';
import { type LocalEntity, Scope, type ScopeSnapshot } from './scope.ts';

/** A scope state, noted for a node from where `start` starts on. */
interface NotedSnapshot {
  readonly start: AnchoredSpan;
  readonly snapshot: ScopeSnapshot;
}

/** A note code written after it may go on: an empty node's, or a block's after a statement. */
interface TrailingNote extends NotedSnapshot {
  readonly node: SyntaxNode;
}

/** A note with its start as a text offset, for comparing with a cursor's. */
interface PlacedSnapshot {
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

/** Spaces, tabs, line breaks and comments alone: no code written. */
const blank = /^(?:[ \t\r\n]|#[^\r\n]*(?=[\r\n]|$))*$/u;

/** The spaces and tabs a line opens with. */
const indentation = /^[ \t]*/u;

/** Notes, while one tree is bound, the scope each node is bound in. */
export class VisibilityNotes {
  readonly #noted = new Map<SyntaxNode, NotedSnapshot[]>();
  /** The notes of empty nodes, and of blocks after a statement, which code after them may go on. */
  readonly #trailing: TrailingNote[] = [];

  /** Notes that `node`, from where `start` starts on, is bound in `scope` as it is defined now. */
  note(node: SyntaxNode, scope: Scope, start = node.span): void {
    const noted = this.#noted.get(node) ?? [];
    const note = { start, snapshot: scope.snapshot() };
    noted.push(note);
    this.#noted.set(node, noted);
    const afterStatement = node.kind === 'Block' && start !== node.span;
    if (node.span.from === node.span.to || afterStatement) {
      this.#trailing.push({ ...note, node });
    }
  }

  /** The visibility the notes give, with `topLevel` outside every noted node. */
  visibility(topLevel: ScopeSnapshot): Visibility {
    const noted = this.#noted;
    const trailing = this.#trailing;
    return {
      namesAt: (tree, offset) => {
        const placed = (notes: readonly NotedSnapshot[]): readonly PlacedSnapshot[] =>
          notes.map(({ start, snapshot }) => ({ from: spanIn(tree, start).start, snapshot }));
        const goingOn = trailing.filter((note) => goesOn(tree, offset, note));
        // Reversed, so of notes standing together the first noted wins.
        const missing = latestStarted(placed(goingOn).toReversed(), offset);
        const started = (node: SyntaxNode) => latestStarted(placed(noted.get(node) ?? []), offset);
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

/** Of `notes`, the one started last by `offset`; of two starting together, the later in `notes`. */
function latestStarted(
  notes: readonly PlacedSnapshot[],
  offset: number,
): PlacedSnapshot | undefined {
  return notes.reduce<PlacedSnapshot | undefined>(
    (latest, note) =>
      note.from <= offset && (latest === undefined || note.from >= latest.from) ? note : latest,
    undefined,
  );
}

/**
 * Whether code written at `offset` goes on where `note` starts: no code is written between them,
 * and a later line stands deeper than the one its node's construct starts on.
 */
function goesOn(tree: SyntaxTree, offset: number, { node, start }: TrailingNote): boolean {
  const { text } = tree.source;
  const from = spanIn(tree, start).start;
  if (from > offset || !blank.test(text.slice(from, offset))) {
    return false;
  }
  const lineStart = lineStartAt(text, offset);
  const construct = parentOf(tree, node) ?? node;
  return (
    lineStart <= from ||
    offset - lineStart > indentationAt(text, spanIn(tree, construct.span).start)
  );
}

/** The width of the spaces opening the line `offset` is on, up to `offset`. */
function indentationAt(text: string, offset: number): number {
  return indentation.exec(text.slice(lineStartAt(text, offset), offset))?.[0].length ?? 0;
}
