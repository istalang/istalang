/**
 * Bodies after a header's `:`, docstrings and annotations: how an item's parts stand on lines
 * (formatter.md, Style).
 *
 * A one-item body stays on its header's line when it fits, unless the item opens a body of its own
 * outside brackets: an `else` after it would then belong to it (spec §4, "Continuing a
 * construct"). A body with a docstring is always indented, the docstring first. A braced block
 * never moves off the header's line, since breaking before its `{` only adds a level of
 * indentation around the braces; unless a comment or annotation stands before its `{`.
 *
 * Annotations written before an item stand on lines of their own above it; those written after it
 * stay on its line (§3.16).
 */

import { builders } from 'prettier/doc';
import type { Annotatable, Annotation } from '../compiler/syntax/annotations.ts';
import type { Docstring } from '../compiler/syntax/declarations.ts';
import { spanIn } from '../compiler/syntax/positions.ts';
import type { Block } from '../compiler/syntax/statements.ts';
import { extentIn, fieldChildrenOf, type SyntaxNode } from '../compiler/syntax/tree.ts';
import { standingIn } from './brackets.ts';
import { blankBetween, hasComments, hugging, itemLines } from './lists.ts';
import type { Printer } from './printer.ts';

const { hardline, indent, line } = builders;

/** Kinds that open a body of their own, which an `else` after them could continue. */
const bodyOpeners: ReadonlySet<SyntaxNode['kind']> = new Set([
  'If',
  'Match',
  'Select',
  'For',
  'While',
  'LabelledBlock',
  'FunctionDeclaration',
]);

/**
 * The children of `node` that stand outside every delimiter of its own (brackets.ts), where an
 * `else` after it could continue a body they open. A function opens a body itself, so the body its
 * tree holds apart is never asked for.
 */
function undelimitedChildren(node: SyntaxNode): readonly SyntaxNode[] {
  return fieldChildrenOf(node).filter((child) => {
    const standing = standingIn(node, child);
    return standing === 'outside' || standing === 'lines';
  });
}

/** Whether `node` opens a body outside brackets, itself or through a part. */
export function opensBody(node: SyntaxNode): boolean {
  return bodyOpeners.has(node.kind) || undelimitedChildren(node).some(opensBody);
}

/**
 * Whether `statement`, `block`'s one item, is a braced block whose `{` is the first thing the body
 * prints. A comment or annotation before the brace ends its own line, so the body is indented then.
 */
function startsWithBrace(printer: Printer, block: Block, statement: SyntaxNode): boolean {
  if (statement.kind !== 'ExpressionStatement' || statement.expression.kind !== 'BlockExpression') {
    return false;
  }
  const brace = extentIn(printer.tree, statement.expression).start;
  return [block, statement, statement.expression].every(
    (node) => printer.extentOf(node).start === brace,
  );
}

/**
 * `block` after its header's `:`, which the caller prints; the caller groups header and body, so a
 * comment ending the header's line breaks the body onto the next.
 */
export function body(printer: Printer, block: Block): builders.Doc {
  const [only, ...rest] = block.statements;
  const header = printer.dangling(block);
  if (only === undefined || rest.length > 0 || opensBody(only)) {
    return [header, indent([hardline, printer.print(block)])];
  }
  if (startsWithBrace(printer, block, only)) {
    return [header, ' ', printer.print(block)];
  }
  const indented = indent([line, printer.print(block)]);
  return hugsItsBrackets(printer, only)
    ? [header, hugging([' ', printer.print(block), ''], indented)]
    : [header, indented];
}

/** Kinds of a body's one item that keep their opening bracket on the header's line. */
const huggedKinds: ReadonlySet<SyntaxNode['kind']> = new Set([
  'ArrayLiteral',
  'MapLiteral',
  'Comprehension',
  'StructLiteral',
  'NewStructLiteral',
]);

function hugsItsBrackets(printer: Printer, statement: SyntaxNode): boolean {
  return (
    statement.kind === 'ExpressionStatement' &&
    huggedKinds.has(statement.expression.kind) &&
    !hasComments(printer, statement) &&
    !hasComments(printer, statement.expression)
  );
}

/** `block` indented under its header's `:`, as a labelled block's must be (§4). */
export function indentedBlock(printer: Printer, block: Block): builders.Doc {
  return [printer.dangling(block), indent([hardline, printer.print(block)])];
}

/** An indented body of `items`, `doc` first, after a header's `:` the caller prints. */
export function indentedBody(
  printer: Printer,
  doc: Docstring | undefined,
  items: readonly SyntaxNode[],
): builders.Doc {
  const parts = doc === undefined ? items : [doc, ...items];
  const header = doc === undefined ? '' : printer.dangling(doc);
  return [header, indent([hardline, itemLines(printer, parts)])];
}

/** A function's body after its `:`, with its docstring first when it has one. */
export function functionBody(
  printer: Printer,
  doc: Docstring | undefined,
  block: Block,
): builders.Doc {
  if (doc === undefined) {
    return body(printer, block);
  }
  const blank = blankBetween(printer, doc, block) ? hardline : '';
  return [
    printer.dangling(doc),
    indent([
      hardline,
      printer.print(doc),
      hardline,
      blank,
      printer.dangling(block),
      printer.print(block),
    ]),
  ];
}

/** A docstring on the line after a declaration that has no indented body, deeper than it (§2). */
export function docBelow(printer: Printer, doc: Docstring | undefined): builders.Doc {
  return doc === undefined ? '' : [printer.dangling(doc), indent([hardline, printer.print(doc)])];
}

/** Whitespace and comments: what may stand between an item's annotations and the item. */
const trivia = /(?:\s|#[^\r\n]*)*/uy;

/** The offset of the first token at or after `offset`. */
function tokenAfter(text: string, offset: number): number {
  trivia.lastIndex = offset;
  trivia.exec(text);
  return trivia.lastIndex;
}

/** `core`, the item without its annotations, with those of `node` around it. */
export function annotated(
  printer: Printer,
  node: SyntaxNode & Annotatable,
  core: builders.Doc,
): builders.Doc {
  const { tree } = printer;
  const before: Annotation[] = [];
  let offset = spanIn(tree, node.span).start;
  for (const annotation of node.annotations ?? []) {
    const written = spanIn(tree, annotation.span);
    if (tokenAfter(tree.source.text, offset) !== written.start) {
      break;
    }
    before.push(annotation);
    offset = written.end;
  }
  const after = (node.annotations ?? []).slice(before.length);
  return [
    before.map((annotation) => [printer.print(annotation), hardline]),
    core,
    after.map((annotation) => [' ', printer.print(annotation)]),
  ];
}
