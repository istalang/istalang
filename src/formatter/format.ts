/**
 * The formatter's entry (formatter.md): a syntax tree to its canonical text, and the public API
 * `istalang/formatter` over text.
 *
 * The style has no options (2-space indent, width 100). A tree with syntax diagnostics is refused:
 * the parser recovered from the errors by guesses, and printing a guess would rewrite the user's
 * code into something they didn't write.
 *
 * Printing goes through Prettier's doc printer (`prettier/doc`), which needs no parser or plugin:
 * each construct builds a doc of groups, indents and line breaks, and the printer chooses where
 * groups break to keep within the width. The table of printers is exhaustive by type, the binder's
 * pattern (structures/kind-table.ts), so a new node kind fails to compile until it prints.
 */

import { type builders, printer as docPrinter } from 'prettier/doc';
import { parse } from '../compiler/parser/parse.ts';
import { scan } from '../compiler/scanner/scan.ts';
import { spanIn } from '../compiler/syntax/positions.ts';
import { childrenOf, extentIn, type SyntaxNode, type SyntaxTree } from '../compiler/syntax/tree.ts';
import { handlerOf } from '../structures/kind-table.ts';
import { unreachable } from '../structures/unreachable.ts';
import { createSourceText, type SourceText } from '../text/source-text.ts';
import { encloses, type Span } from '../text/span.ts';
import { nodesInBrackets } from './brackets.ts';
import { branchPrinters } from './branches.ts';
import { placeComments } from './comment-placement.ts';
import {
  type CommentsOf,
  danglingDocs,
  leadingDocs,
  type PlacedComment,
  trailingDocs,
} from './comments.ts';
import { declarationPrinters } from './declarations.ts';
import { expressionPrinters } from './expressions.ts';
import { isMultiLine, literalPrinters } from './literals.ts';
import { patternPrinters } from './patterns.ts';
import type { Printer, Printers } from './printer.ts';
import { statementPrinters } from './statements.ts';
import { typePrinters } from './types.ts';

const printWidth = 100;
const tabWidth = 2;

const errorNode = (): never =>
  unreachable('The formatter refuses trees with syntax diagnostics, so none holds an error node.');

const printers: Printers<SyntaxNode> = {
  ...declarationPrinters,
  ...statementPrinters,
  ...branchPrinters,
  ...expressionPrinters,
  ...literalPrinters,
  ...patternPrinters,
  ...typePrinters,
  // biome-ignore lint/style/useNamingConvention: the keys are the tree's node kinds.
  Identifier: (_, node) => node.text,
  // biome-ignore lint/style/useNamingConvention: the keys are the tree's node kinds.
  Missing: errorNode,
  // biome-ignore lint/style/useNamingConvention: the keys are the tree's node kinds.
  Invalid: errorNode,
};

const noComments: CommentsOf = { leading: [], trailing: [], dangling: [] };

class TreePrinter implements Printer {
  readonly tree: SyntaxTree;
  readonly #placement: ReadonlyMap<SyntaxNode, CommentsOf>;
  readonly #inBrackets: ReadonlySet<SyntaxNode>;
  readonly #printed = new Set<PlacedComment>();

  constructor(tree: SyntaxTree, placement: ReadonlyMap<SyntaxNode, CommentsOf>) {
    this.tree = tree;
    this.#placement = placement;
    this.#inBrackets = nodesInBrackets(tree);
  }

  print(node: SyntaxNode): builders.Doc {
    return this.withComments(
      node,
      handlerOf<Printer, SyntaxNode, [], builders.Doc>(printers, node)(this, node),
    );
  }

  withComments(node: SyntaxNode, doc: builders.Doc): builders.Doc {
    const { leading, trailing } = this.#commentsOf(node);
    this.#mark(leading);
    this.#mark(trailing);
    return [leadingDocs(leading), doc, trailingDocs(trailing)];
  }

  dangling(node: SyntaxNode): builders.Doc {
    const { dangling } = this.#commentsOf(node);
    this.#mark(dangling);
    return danglingDocs(dangling);
  }

  extentOf(node: SyntaxNode): Span {
    const { leading, trailing } = this.#commentsOf(node);
    const extent = extentIn(this.tree, node);
    return {
      start: leading[0]?.span.start ?? extent.start,
      end: trailing.at(-1)?.span.end ?? extent.end,
    };
  }

  inBrackets(node: SyntaxNode): boolean {
    return this.#inBrackets.has(node);
  }

  /** Every placed comment no printer has printed: none, unless a printer misses one. */
  unprinted(): readonly PlacedComment[] {
    return [...this.#placement.values()]
      .flatMap(({ leading, trailing, dangling }) => [...leading, ...trailing, ...dangling])
      .filter((comment) => !this.#printed.has(comment));
  }

  #commentsOf(node: SyntaxNode): CommentsOf {
    return this.#placement.get(node) ?? noComments;
  }

  #mark(comments: readonly PlacedComment[]): void {
    for (const comment of comments) {
      this.#printed.add(comment);
    }
  }
}

/** The spans of the literals printed as copies, whose comments are copied with them. */
function copiedSpans(tree: SyntaxTree, node: SyntaxNode): readonly Span[] {
  return isMultiLine(tree, node)
    ? [spanIn(tree, node.span)]
    : childrenOf(tree, node).flatMap((child) => copiedSpans(tree, child));
}

/** `tree`'s canonical text; undefined when it has syntax diagnostics, which are the reason. */
export function formatTree(tree: SyntaxTree): string | undefined {
  if (tree.diagnostics.length > 0) {
    return undefined;
  }
  const copied = copiedSpans(tree, tree.root);
  const placement = placeComments(tree, (comment) =>
    copied.some((span) => encloses(span, comment.span)),
  );
  const printer = new TreePrinter(tree, placement);
  const doc = printer.print(tree.root);
  const [missed] = printer.unprinted();
  if (missed !== undefined) {
    unreachable(`No printer printed the comment at ${missed.span.start}: ${missed.text}`);
  }
  return docPrinter.printDocToString(doc, { printWidth, tabWidth }).formatted;
}

/** What formatting a source gives: its tree, whose diagnostics say why `text` is undefined. */
export interface FormattedSource {
  readonly tree: SyntaxTree;
  readonly text: string | undefined;
}

/** `source` parsed and formatted. */
export function formatSource(source: SourceText): FormattedSource {
  const tree = parse(source, scan(source));
  return { tree, text: formatTree(tree) };
}

/** `text` formatted as a module; undefined when it has syntax errors. */
export function formatText(text: string): string | undefined {
  return formatSource(createSourceText('formatted.ista', text)).text;
}
