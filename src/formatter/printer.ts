/**
 * The seam every construct's printer works through (formatter.md, Decisions). A printer gets the
 * node narrowed to its kind and returns a Prettier doc; it prints each child through `print`, which
 * dispatches on the child's kind and wraps it in the comments placed on it, so no construct knows
 * another's printer and no comment can be skipped by printing a child some other way.
 *
 * The one implementation is the formatter's entry (format.ts), which owns the table of printers.
 */

import type { builders } from 'prettier/doc';
import type { SyntaxNode, SyntaxTree } from '../compiler/syntax/tree/index.ts';
import type { Handlers } from '../foundation/structures/kind-table.ts';
import type { Span } from '../foundation/text/span.ts';

export interface Printer {
  /** The tree printed, which holds its text and its functions' bodies. */
  readonly tree: SyntaxTree;
  /** `node` printed by its kind's printer, with the comments placed before and after it. */
  readonly print: (node: SyntaxNode) => builders.Doc;
  /** `doc`, printed in place of `node`'s own printer, with `node`'s comments around it. */
  readonly withComments: (node: SyntaxNode, doc: builders.Doc) => builders.Doc;
  /** The comments left to `node`'s own printer, printed where it puts them; '' for none. */
  readonly dangling: (node: SyntaxNode) => builders.Doc;
  /** Whether `node` has comments left to its own printer, asked without printing them. */
  readonly hasDangling: (node: SyntaxNode) => boolean;
  /** `node`'s span widened to the comments printed before and after it. */
  readonly extentOf: (node: SyntaxNode) => Span;
  /**
   * Whether `node` stands in brackets, where a line break may stand anywhere (layout/brackets.ts).
   */
  readonly inBrackets: (node: SyntaxNode) => boolean;
}

/** One printer per kind of `Node`. */
export type Printers<Node extends SyntaxNode> = Handlers<Printer, Node, [], builders.Doc>;
