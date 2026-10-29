/**
 * Where a module folds: every bracket pair, every indented block and every list of items that
 * spans lines.
 *
 * Brackets are found from the code's tokens, a template's values' included, so every kind of
 * bracketed list folds alike: arguments,
 * parameters, collections, struct literals, braced blocks. Layout (§4) is found from the tree,
 * since only the parser knows where an indented block or an item list begins and ends:
 * - an indented block folds from the line that introduces it, where its `:` stands, past any
 *   docstring between, to its last line;
 * - a declaration's members, and a `match`'s or a `select`'s cases, fold from the line naming the
 *   declaration or holding the keyword.
 *
 * A fold shows its first line and hides the rest, so one starting and ending on the same line
 * hides nothing and isn't listed. Two folds starting on one line keep the longer: an editor shows
 * one fold per line.
 */

import type { Identifier } from '../compiler/syntax/node.ts';
import type { Token } from '../compiler/syntax/tokens.ts';
import { nodesUnder, type SyntaxNode, type SyntaxTree } from '../compiler/syntax/tree.ts';
import { lastIndexAtMost } from '../structures/sorted.ts';
import { type LineMap, lineMapOf } from '../text/line-map.ts';
import type { Span } from '../text/span.ts';
import { codeTokensOf } from './tokens.ts';

/** Lines `start` through `end`, 0-based. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

const closers: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };

/** Every fold of `tree`, by its first line. */
export function foldingRangesOf(tree: SyntaxTree): readonly LineRange[] {
  const lines = lineMapOf(tree.source);
  const tokens = codeTokensOf(tree);
  const spans = [...bracketSpans(tokens), ...layoutSpans(tree, tokens)];
  const longestByStart = new Map<number, LineRange>();
  for (const span of spans) {
    const range = lineRangeOf(lines, span);
    const known = longestByStart.get(range.start);
    if (range.end > range.start && (known === undefined || range.end > known.end)) {
      longestByStart.set(range.start, range);
    }
  }
  return [...longestByStart.values()].sort((first, second) => first.start - second.start);
}

function lineRangeOf(lines: LineMap, span: Span): LineRange {
  return {
    start: lines.positionAt(span.start).line,
    end: lines.positionAt(Math.max(span.start, span.end - 1)).line,
  };
}

/** From each opening bracket through the one closing it; an unclosed bracket folds nothing. */
function bracketSpans(tokens: readonly Token[]): readonly Span[] {
  const open: Token[] = [];
  const spans: Span[] = [];
  for (const token of tokens) {
    const opener = closers[token.kind];
    if (opener === undefined) {
      if (token.kind === '(' || token.kind === '[' || token.kind === '{') {
        open.push(token);
      }
    } else if (open.at(-1)?.kind === opener) {
      const start = open.pop()?.span.start ?? token.span.start;
      spans.push({ start, end: token.span.end });
    }
  }
  return spans;
}

/** Indented blocks and item lists, which fold by layout rather than by brackets. */
function layoutSpans(tree: SyntaxTree, tokens: readonly Token[]): readonly Span[] {
  return nodesUnder(tree, tree.root).flatMap((node) => {
    const start = layoutStart(node, tokens);
    return start === undefined ? [] : [{ start, end: node.span.end }];
  });
}

type LayoutStarts = {
  readonly [Kind in SyntaxNode['kind']]?: (
    node: Extract<SyntaxNode, { readonly kind: Kind }>,
    tokens: readonly Token[],
  ) => number | undefined;
};

const named = (node: { readonly name: Identifier }) => node.name.span.start;

/** Where each node that folds by layout starts its fold. */
// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const layoutStarts: LayoutStarts = {
  // An indented block starts where its first statement does; a braced one is a bracket pair.
  Block: (node, tokens) =>
    node.statements[0]?.span.start === node.span.start
      ? tokens[lastIndexAtMost(tokens, (token) => token.span.end, node.span.start)]?.span.start
      : undefined,
  StructDeclaration: named,
  SharedStructDeclaration: named,
  EnumDeclaration: named,
  Variant: named,
  TraitDeclaration: named,
  Match: (node) => node.span.start,
  Select: (node) => node.span.start,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** Where a fold of `node` by layout starts; undefined for a node that doesn't fold by layout. */
function layoutStart(node: SyntaxNode, tokens: readonly Token[]): number | undefined {
  const startOf = layoutStarts[node.kind] as
    | ((node: SyntaxNode, tokens: readonly Token[]) => number | undefined)
    | undefined;
  return startOf?.(node, tokens);
}
