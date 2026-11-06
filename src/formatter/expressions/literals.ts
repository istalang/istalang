/**
 * Literals print from their source text (formatter.md, Decisions), so `0x1F_FF`, `5d`, quotes and
 * escapes keep their spelling; the tree holds only decoded values.
 *
 * A multi-line template or docstring is copied whole, its `${…}` parts and their comments too:
 * its value depends on the indentation its lines share (scanner/multi-line.ts), which reprinting
 * its parts could change. The copy moves its later lines with its first: they lose the
 * indentation the source gave the literal's first line, and take the one the output gives it
 * (`markAsRoot`). That holds the value only when every later line had that indentation, which a
 * rescan of the moved text confirms; otherwise the lines are copied as they stand.
 *
 * A single-line template prints its values formatted on one line. One whose value can't be (a
 * braced block of several lines) is copied as it stands, which the source proves valid.
 */

import { builders, utils } from 'prettier/doc';
import { scan } from '../../compiler/scanner/scan.ts';
import type { Docstring } from '../../compiler/syntax/declarations/index.ts';
import type { TemplateLiteral } from '../../compiler/syntax/expressions/index.ts';
import type { Literal } from '../../compiler/syntax/expressions/literals/literals.ts';
import { spanIn } from '../../compiler/syntax/positions.ts';
import type { Token } from '../../compiler/syntax/tokens.ts';
import type { SyntaxNode, SyntaxTree } from '../../compiler/syntax/tree.ts';
import { indentationAt, splitLines } from '../../text/line-map.ts';
import { createSourceText } from '../../text/source-text.ts';
import { textOf } from '../../text/span.ts';
import { oneLine } from '../lists.ts';
import type { Printer, Printers } from '../printer.ts';

const { lineSuffixBoundary, literalline, markAsRoot } = builders;

/** Literals spanning lines, which print as copies. */
export type CopiedLiteral = TemplateLiteral | Docstring;

/** Whether `node` is a template or docstring spanning lines. */
export function isMultiLine(tree: SyntaxTree, node: SyntaxNode): node is CopiedLiteral {
  return (
    (node.kind === 'TemplateLiteral' || node.kind === 'Docstring') &&
    splitLines(writtenText(tree, node)).length > 1
  );
}

/** The text `node` was written as. */
function writtenText(tree: SyntaxTree, node: SyntaxNode): string {
  return textOf(tree.source, spanIn(tree, node.span));
}

type LiteralNode = Literal | Extract<SyntaxNode, { kind: 'TemplateText' | 'Docstring' }>;

const asWritten = (printer: Printer, node: SyntaxNode): builders.Doc =>
  writtenText(printer.tree, node);

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const literalPrinters: Printers<LiteralNode | TemplateLiteral> = {
  IntegerLiteral: asWritten,
  FloatLiteral: asWritten,
  DurationLiteral: asWritten,
  StringLiteral: asWritten,
  BooleanLiteral: asWritten,
  NoneLiteral: asWritten,
  TemplateText: asWritten,
  Docstring: (printer, node) =>
    isMultiLine(printer.tree, node) ? copied(printer.tree, node) : asWritten(printer, node),
  TemplateLiteral: (printer, node) =>
    isMultiLine(printer.tree, node) ? copied(printer.tree, node) : oneLineTemplate(printer, node),
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

function oneLineTemplate(printer: Printer, node: TemplateLiteral): builders.Doc {
  const values = node.values.map((value) => printer.print(value));
  if (values.some((value) => utils.willBreak(value))) {
    return asWritten(printer, node);
  }
  const parts = node.texts.map((text, index) => {
    const value = values[index];
    return [printer.print(text), value === undefined ? '' : ['${', oneLine(value), '}']];
  });
  return [node.tag === undefined ? '' : printer.print(node.tag), '`', parts, '`'];
}

function copied(tree: SyntaxTree, node: CopiedLiteral): builders.Doc {
  const [first = '', ...later] = splitLines(writtenText(tree, node));
  const moved = movedLines(tree, node, first, later);
  const lines = (moved ?? later).map((text) =>
    // A blank line takes no indentation: the value ignores it, and the output stays trimmed.
    moved === undefined || text === '' ? [literalline, text] : [markAsRoot(literalline), text],
  );
  return [lineSuffixBoundary, first, lines];
}

/** `later` without the indentation of the literal's first line, if that keeps its value. */
function movedLines(
  tree: SyntaxTree,
  node: CopiedLiteral,
  first: string,
  later: readonly string[],
): readonly string[] | undefined {
  const { start } = spanIn(tree, node.span);
  const indentation = ' '.repeat(indentationAt(tree.source.text, start));
  // A line of spaces shorter than the indentation is blank and moves as an empty line; the spaces
  // of a longer one past the indentation are part of the value, so they move with it.
  const moved = later.map((text) =>
    text.trim() === '' && !text.startsWith(indentation) ? '' : text,
  );
  if (moved.some((text) => text !== '' && !text.startsWith(indentation))) {
    return undefined;
  }
  const result = moved.map((text) => text.slice(indentation.length));
  const value = decoded([first, ...later].join('\n'));
  return value !== undefined && value === decoded([first, ...result].join('\n'))
    ? result
    : undefined;
}

/** What scanning `text` alone decodes, spans left out; undefined when it doesn't scan clean. */
function decoded(text: string): string | undefined {
  const { tokens, diagnostics } = scan(createSourceText('literal.ista', text));
  return diagnostics.length > 0 ? undefined : JSON.stringify(tokens.map(tokenValue));
}

function tokenValue(token: Token): unknown {
  switch (token.kind) {
    case 'template':
      return [
        token.kind,
        token.texts.map(({ value }) => value),
        token.values.map(({ tokens }) => tokens.map(tokenValue)),
      ];
    case 'integer':
    case 'duration':
    case 'float':
    case 'string':
    case 'docstring':
      return [token.kind, String(token.value)];
    default:
      return token.kind;
  }
}
