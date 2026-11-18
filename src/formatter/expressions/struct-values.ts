/**
 * A struct value where an indented value may open (spec §2): after the `=` of a `const`, a `let`,
 * an assignment or a struct field's default, after `return`, after an entry's `:` or an item's
 * `-`. There the formatter picks the form by width, whichever was written: braces,
 * `Point{x: 1, y: 2}`, when the line fits a compressed form's width (../layout/compact.ts), else
 * the indented value, `Point:` and a field per line below, which builds the same struct.
 *
 * - A literal in braces moves only where its parent's position allows: one in brackets, in a body,
 *   or under a literal that keeps its braces stays in braces, broken across lines when long.
 * - Only what both forms can say moves: named fields, a spread first, a struct comprehension last.
 *   A single field given without its name keeps its braces (§2), and a value with a comment in it,
 *   right before it or after its last line, or a blank line between its entries keeps the form it
 *   was written in.
 * - `struct{…}` names no type, so its indented form opens on the lines below, with nothing after
 *   the opening.
 */

import { builders } from 'prettier/doc';
import type { FieldsLiteral, IndentedValue } from '../../compiler/syntax/expressions/index.ts';
import { extentIn, parentOf, type SyntaxNode } from '../../compiler/syntax/tree/index.ts';
import { compactGroup } from '../layout/compact.ts';
import { blankBetween, hasComments, holdsComments } from '../layout/lists.ts';
import type { Printer } from '../printer.ts';
import { entryRows } from './entry-rows.ts';

const { hardlineWithoutBreakParent, ifBreak, indent, join } = builders;

/** A struct value either form can print. */
type StructValue = FieldsLiteral | IndentedValue;

/**
 * `opening` and `value` in the form that fits (banner); undefined when `value` keeps its own form.
 */
export function structValueForms(
  printer: Printer,
  opening: string,
  value: SyntaxNode,
): builders.Doc | undefined {
  if (!(isStructValue(value) && movesForm(printer, value))) {
    return;
  }
  const entries = entriesOf(value);
  const type = typeDoc(printer, value);
  const flat = join(
    ', ',
    entries.map((entry) => printer.print(entry)),
  );
  const braces = [' ', type ?? 'struct', '{', flat, '}'];
  // Line breaks only the indented form prints, which mustn't break the group as a hard line would.
  const block = indent([hardlineWithoutBreakParent, indentedRows(printer, value)]);
  const indented = type === undefined ? block : [' ', type, ':', block];
  return compactGroup([opening, ifBreak(indented, braces)]);
}

function isStructValue(node: SyntaxNode): node is StructValue {
  if (node.kind === 'StructLiteral' || node.kind === 'NewStructLiteral') {
    return true;
  }
  return node.kind === 'IndentedValue' && node.entries.every(isNamedEntry);
}

function entriesOf(value: StructValue): readonly SyntaxNode[] {
  return value.kind === 'IndentedValue' ? value.entries : value.items;
}

/** An indented value's entries on the lines they were written on; a literal's, one per line. */
function indentedRows(printer: Printer, value: StructValue): builders.Doc {
  if (value.kind === 'IndentedValue') {
    return entryRows(printer, value.entries, hardlineWithoutBreakParent);
  }
  return join(
    hardlineWithoutBreakParent,
    value.items.map((item) => printer.print(item)),
  );
}

/** `T`, `new T`, or undefined for a value naming no type. */
function typeDoc(printer: Printer, value: StructValue): builders.Doc | undefined {
  if (value.type === undefined) {
    return;
  }
  const isNew =
    value.kind === 'NewStructLiteral' || (value.kind === 'IndentedValue' && value.isNew);
  return [isNew ? 'new ' : '', printer.print(value.type)];
}

/** Whether `entry` is one both forms hold: a named field, a spread or a struct comprehension. */
function isNamedEntry(entry: SyntaxNode): boolean {
  return (
    entry.kind === 'FieldInitializer' ||
    entry.kind === 'Spread' ||
    entry.kind === 'StructComprehension'
  );
}

/** Whether `value` stands where either form may, and holds only what both can say (banner). */
function movesForm(printer: Printer, value: StructValue): boolean {
  const entries = entriesOf(value);
  const [first] = entries;
  const spreadsLater = entries.some((entry, index) => index > 0 && entry.kind === 'Spread');
  const comprehendsEarlier = entries.some(
    (entry, index) => index < entries.length - 1 && entry.kind === 'StructComprehension',
  );
  return (
    first !== undefined &&
    entries.every(isNamedEntry) &&
    !spreadsLater &&
    !comprehendsEarlier &&
    !hasComments(printer, value) &&
    !holdsComments(printer, value) &&
    !commentedBefore(printer, value) &&
    !entries.some((entry) => hasComments(printer, entry)) &&
    !entries.some(
      (entry, index) => index > 0 && blankBetween(printer, entries[index - 1] ?? entry, entry),
    ) &&
    opensIndentedValue(printer, value)
  );
}

/**
 * Whether a comment stands right before `value`, nothing but whitespace between: after its opening,
 * as `= # note` or a key's `:` above its block, where the braces would part them.
 */
function commentedBefore(printer: Printer, value: StructValue): boolean {
  const { tree } = printer;
  const { start } = extentIn(tree, value);
  return tree.comments.some(
    ({ span }) => span.end <= start && tree.source.text.slice(span.end, start).trim() === '',
  );
}

/** Whether an indented value may open where `value` stands (banner). */
function opensIndentedValue(printer: Printer, value: SyntaxNode): boolean {
  const parent = parentOf(printer.tree, value);
  switch (parent?.kind) {
    case 'VariableDeclaration':
    case 'ContextConstantDeclaration':
    case 'Return':
      return !printer.inBrackets(value);
    case 'Assignment':
      return parent.operator === '=' && !printer.inBrackets(value);
    case 'DeclaredField':
      return parentOf(printer.tree, parent)?.kind !== 'Variant';
    case 'FieldInitializer': {
      const literal = parentOf(printer.tree, parent);
      return (
        literal?.kind === 'IndentedValue' ||
        (literal !== undefined && isMovingLiteral(printer, literal))
      );
    }
    case 'QuotedEntry':
    case 'IndentedItem':
      return true;
    default:
      return false;
  }
}

/** Whether `node` is a literal in braces that moves form, so its fields may move theirs. */
function isMovingLiteral(printer: Printer, node: SyntaxNode): boolean {
  return (
    (node.kind === 'StructLiteral' || node.kind === 'NewStructLiteral') && movesForm(printer, node)
  );
}
