/**
 * What the formatter's tests read: the inputs its acceptance runs over (formatter.md, Acceptance),
 * and what they compare between an input and its output.
 */

import { corpusFiles } from '../../test/corpus/programs.ts';
import { specExamples } from '../../test/corpus/spec-examples.ts';
import { parse } from '../compiler/parser/parse.ts';
import { scan } from '../compiler/scanner/scan.ts';
import { type ImportDeclaration, isBoundByAll } from '../compiler/syntax/declarations/index.ts';
import {
  extentIn,
  nodesUnder,
  type SyntaxNode,
  type SyntaxTree,
} from '../compiler/syntax/tree/index.ts';
import { dump, dumpViewed } from '../compiler/syntax/tree/tree.test-kit.ts';
import { lineMapOf, splitLines } from '../foundation/text/line-map.ts';
import { createSourceText } from '../foundation/text/source-text.ts';
import { textOf } from '../foundation/text/span.ts';
import { isStructShaped } from './expressions/struct-values.ts';
import { formatTree } from './format.ts';
import { nodesInBrackets } from './layout/brackets.ts';

const printWidth = 100;

/** Lines joined into a module's text, ending in a line break as a formatted module does. */
export const lines = (...text: readonly string[]): string => `${text.join('\n')}\n`;

export function parseText(text: string): SyntaxTree {
  const source = createSourceText('formatted.ista', text);
  return parse(source, scan(source));
}

/**
 * Every corpus file and spec example that parses without diagnostics; the formatter refuses the
 * others.
 */
export const formattableInputs: readonly { readonly name: string; readonly text: string }[] = [
  ...corpusFiles,
  ...specExamples.map(({ document, line, code }) => ({ name: `${document}:${line}`, text: code })),
].filter(({ text }) => parseText(text).diagnostics.length === 0);

/**
 * Acceptance 1–3 for `text` (formatter.md): what its format re-parses to (diagnostics, tree,
 * comments) and formats to again, beside what each must be. Trees compare as `dumpAsFormatted`
 * reads them, and comments, which move with imports, as a sorted list.
 */
export function roundTripOf(text: string) {
  const tree = parseText(text);
  const formatted = formatTree(tree) ?? '';
  const reparsed = parseText(formatted);
  return {
    formatted,
    reparsed,
    actual: {
      diagnostics: reparsed.diagnostics,
      tree: dumpAsFormatted(reparsed),
      comments: commentTexts(reparsed).toSorted(),
      formattedAgain: formatTree(reparsed),
    },
    expected: {
      diagnostics: [],
      tree: dumpAsFormatted(tree),
      comments: commentTexts(tree).toSorted(),
      formattedAgain: formatted,
    },
  };
}

/**
 * `tree` dumped as formatting keeps it: its items other than imports, in order, then what its
 * imports bind, one entry per item and path, sorted, since the formatter merges and sorts them and
 * drops a name a `*` of its path binds too (imports.ts); a struct value in braces or indented
 * alike, whose form its width picks (expressions/struct-values.ts); and an expression with or
 * without parentheses, which the formatter adds where they clarify
 * (expressions/clarifying-parentheses.ts) and the tree's shape already says.
 */
function dumpAsFormatted(tree: SyntaxTree): string {
  const { items } = tree.root;
  const imports = items.filter((item) => item.kind === 'ImportDeclaration');
  const allPaths = new Set(
    imports.flatMap((each) =>
      each.items.some((item) => item.kind === 'ImportedAll') ? [dump(tree, each.path)] : [],
    ),
  );
  const binds = (declaration: ImportDeclaration) => (item: ImportDeclaration['items'][number]) =>
    !(
      item.kind === 'ImportedName' &&
      isBoundByAll(item) &&
      allPaths.has(dump(tree, declaration.path))
    );
  const imported = imports.flatMap((item) =>
    item.items.filter(binds(item)).map((each) => `${dump(tree, item.path)} ${dump(tree, each)}`),
  );
  const others = items.filter((item) => item.kind !== 'ImportDeclaration');
  return [
    ...imported.toSorted(),
    ...others.map((item) => dumpViewed(tree, item, asFormatted)),
  ].join('\n');
}

/** A struct value as the literal in braces it builds, an expression without parentheses. */
function asFormatted(node: SyntaxNode): SyntaxNode {
  if (node.kind === 'Parenthesized') {
    return asFormatted(node.expression);
  }
  if (node.kind !== 'IndentedValue' || !isStructShaped(node)) {
    return node;
  }
  const { span, type, entries: items } = node;
  return node.isNew && type !== undefined
    ? { kind: 'NewStructLiteral', span, type, items }
    : { kind: 'StructLiteral', span, type, items };
}

/** The text of each comment of `tree`, in order. */
export function commentTexts(tree: SyntaxTree): readonly string[] {
  return tree.comments.map(({ span }) => textOf(tree.source, span));
}

/** The lines `tree` spans from `start` to `end`, zero-based. */
function linesOf(tree: SyntaxTree, start: number, end: number): readonly number[] {
  const lineMap = lineMapOf(tree.source);
  const first = lineMap.positionAt(start).line;
  const last = lineMap.positionAt(end).line;
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

/**
 * The lines of `tree`'s text longer than the width with nothing to say why: a line may be long
 * because one comment or literal token is, or because it holds an import's names or an operator
 * run outside brackets, neither of which a line break may part (spec §2.1).
 */
export function unexplainedLongLines(tree: SyntaxTree): readonly string[] {
  const inBrackets = nodesInBrackets(tree);
  const unbreakable = new Set(
    nodesUnder(tree, tree.root)
      .filter(
        (node) =>
          node.kind === 'ImportDeclaration' ||
          ((node.kind === 'Binary' || node.kind === 'ChainedComparison') && !inBrackets.has(node)),
      )
      .flatMap((node) => {
        const { start, end } = extentIn(tree, node);
        return linesOf(tree, start, end);
      }),
  );
  const tokens = [
    ...scan(tree.source).tokens.filter(
      ({ kind }) => kind === 'string' || kind === 'template' || kind === 'docstring',
    ),
    ...tree.comments,
  ];
  const { lineStarts } = lineMapOf(tree.source);
  const { text } = tree.source;
  return splitLines(text).filter((line, index) => {
    const { length } = [...line];
    if (length <= printWidth || unbreakable.has(index)) {
      return false;
    }
    const start = lineStarts[index] ?? 0;
    const longest = Math.max(
      0,
      ...tokens
        .filter(({ span }) => span.start < start + line.length && span.end > start)
        .map(({ span }) => Math.min(span.end, start + line.length) - Math.max(span.start, start)),
    );
    return length - longest > printWidth;
  });
}
