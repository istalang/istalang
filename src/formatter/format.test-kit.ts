/**
 * What the formatter's tests read: the inputs its acceptance runs over (formatter.md, Acceptance),
 * and what they compare between an input and its output.
 */

import { corpusFiles } from '../../test/corpus/programs.ts';
import { specExamples } from '../../test/corpus/spec-examples.ts';
import { parse } from '../compiler/parser/parse.ts';
import { scan } from '../compiler/scanner/scan.ts';
import { nodesUnder, type SyntaxTree } from '../compiler/syntax/tree.ts';
import { lineMapOf } from '../text/line-map.ts';
import { createSourceText } from '../text/source-text.ts';
import { textOf } from '../text/span.ts';
import { nodesInBrackets } from './brackets.ts';

const printWidth = 100;

const lineBreak = /\r\n|\r|\n/u;

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

/** The text of each comment of `tree`, in order. */
export function commentTexts(tree: SyntaxTree): readonly string[] {
  return tree.comments.map(({ span }) => textOf(tree.source, span));
}

/** The lines `tree` spans from `start` to `end`, zero-based. */
function linesOf(tree: SyntaxTree, start: number, end: number): readonly number[] {
  const lines = lineMapOf(tree.source);
  const first = lines.positionAt(start).line;
  const last = lines.positionAt(end).line;
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

/**
 * The lines of `tree`'s text longer than the width with nothing to say why: a line may be long
 * because one comment or literal token is, or because it holds an import's names or an operator
 * run outside brackets, neither of which a line break may part (spec §2).
 */
export function unexplainedLongLines(tree: SyntaxTree): readonly string[] {
  const inBrackets = nodesInBrackets(tree.root);
  const unbreakable = new Set(
    nodesUnder(tree.root)
      .filter(
        (node) =>
          node.kind === 'NamedImport' ||
          node.kind === 'NamespaceImport' ||
          ((node.kind === 'Binary' || node.kind === 'ChainedComparison') && !inBrackets.has(node)),
      )
      .flatMap((node) => linesOf(tree, node.span.start, node.span.end)),
  );
  const tokens = [
    ...scan(tree.source).tokens.filter(
      ({ kind }) => kind === 'string' || kind === 'template' || kind === 'docstring',
    ),
    ...tree.comments,
  ];
  const { lineStarts } = lineMapOf(tree.source);
  const { text } = tree.source;
  return text.split(lineBreak).filter((line, index) => {
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
