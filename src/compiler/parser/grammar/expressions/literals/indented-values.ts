/**
 * Indented values (§2): a struct, map or array value written as an indented block.
 *
 * - A value after `=`, `return` or a key's `:` (`parseValue`) is an indented value when its line
 *   ends there, the block below it, or ends in `T:` or `new T:` naming its type, the block below
 *   that; else it is an expression. Inside brackets no line ends for the parser (§2), so no
 *   indented value opens there. A lambda's `:`, a header's and a label's never open one.
 * - The block is read by layout's one block loop (layout/index.ts), entries separated by `,` on a
 *   line. Its lines stand right of the opening line's indentation, or of the column of the entries
 *   it stands among, which a `- key:` item sets right of its line's.
 * - Entries are told apart by their first tokens alone, never by the type, as a struct literal's
 *   items are (struct-literals.ts): `key: value` or `"key": value`, the shorthand `name`,
 *   `...value`, a struct comprehension, and `- item`, whose `-` starts its line and is followed by
 *   a space or the line's end, so `- -1` is the item −1 and a line starting `-1` holds no entry.
 * - An item's value is an expression, a spread, the anonymous keyed value `- key: value` whose
 *   other entries line up with `key`, or a value on the lines below a `-` or a `- T:`. A name
 *   whose `:` ends the item's line is told by its case, as a pattern's bare name is (naming.ts):
 *   `- Point:` names the value's type, `- nested:` is a key whose value is the block below. An
 *   item's expression can't itself start with `- `, which would read as a nested item on one line.
 * - Nothing follows a value: entries after its `T:` on that line are reported, so are lines after
 *   its block by the block they stand in.
 */

import { bindsInPattern } from '../../../../../foundation/language/naming.ts';
import type {
  Expression,
  IndentedEntry,
  IndentedItem,
  IndentedValue,
} from '../../../../syntax/expressions/index.ts';
import type { StringLiteral } from '../../../../syntax/expressions/literals/literals.ts';
import type { NamedType } from '../../../../syntax/types/index.ts';
import { skipUntil } from '../../../cursor/recovery.ts';
import { parserDiagnostics } from '../../../diagnostics.ts';
import { parseBlockBelow } from '../../../layout/bodies.ts';
import { type ItemRules, parseLines } from '../../../layout/index.ts';
import type { Parser } from '../../../parser.ts';
import { nested } from '../../nesting.ts';
import { parseSpread, spreadOpener } from '../../parts/spreads.ts';
import {
  parseStructComprehension,
  reportAfterComprehension,
  structComprehensionOpener,
} from './struct-literals.ts';

/**
 * The value after `=`, `return` or a key's `:`, which `opener` starts the line or entry of: an
 * indented value when the line ends here or in `T:`, else an expression.
 */
export function parseValue(parser: Parser, opener: number): Expression {
  if (endsLine(parser)) {
    return parseBlockValue(parser, opener, undefined);
  }
  return parseNamedValue(parser, opener) ?? parser.expression();
}

/** Whether the line ends at the cursor, so only an indented value can follow on the lines below. */
function endsLine(parser: Parser): boolean {
  const { kind } = parser.cursor;
  return kind === 'lineBreak' || kind === 'end';
}

/** The type an indented value names, `T` of `T:` or `new T:`, with whether `new` built it. */
interface Named {
  readonly type: NamedType;
  readonly isNew: boolean;
  readonly start: number;
}

/** `T:` or `new T:` and the block below, at `T` or `new`; undefined, reading nothing, elsewhere. */
function parseNamedValue(parser: Parser, opener: number): IndentedValue | undefined {
  const named = parser.speculate(() => namedOpening(parser));
  if (named === undefined) {
    return undefined;
  }
  if (!endsLine(parser)) {
    parser.report(parserDiagnostics.valueAfterOpening(parser.nextSpan));
    skipUntil(parser, []);
  }
  return parseBlockValue(parser, opener, named);
}

function namedOpening(parser: Parser): Named | undefined {
  const { cursor } = parser;
  const { start } = cursor.token.span;
  const isNew = parser.atWord('new') && cursor.kindAt(1) === 'identifier';
  if (isNew) {
    cursor.advance();
  }
  if (!cursor.at('identifier')) {
    return undefined;
  }
  const type = parser.type();
  if (type.kind !== 'NamedType' || cursor.eat(':') === undefined) {
    return undefined;
  }
  return { type, isNew, start };
}

/** The block below an opening, of the type `named` gives, or of none. */
function parseBlockValue(parser: Parser, opener: number, named: Named | undefined): IndentedValue {
  const { items, span } = parseBlockBelow(parser, entryRules, columnAbove(parser, opener));
  const entries = checkedEntries(parser, items);
  if (named === undefined) {
    return { kind: 'IndentedValue', span, type: undefined, isNew: false, entries };
  }
  const { type, isNew, start } = named;
  return { kind: 'IndentedValue', span: parser.spanFrom(start), type, isNew, entries };
}

/**
 * The column a value's lines stand right of: its opening line's indentation, or the column of the
 * entries it stands among where that is further right (a `- key:` item's).
 */
function columnAbove(parser: Parser, opener: number): number {
  const { cursor } = parser;
  return Math.max(
    parser.indentationAt(opener),
    cursor.blockColumn ?? cursor.enclosingBlockColumn ?? 0,
  );
}

/** Entries, a struct comprehension's place in them reported as in a struct literal (§3.1). */
function checkedEntries(
  parser: Parser,
  entries: readonly IndentedEntry[],
): readonly IndentedEntry[] {
  reportAfterComprehension(parser, entries);
  return entries;
}

/** Entries nest through their values, so each descends a level (nesting.ts). */
const entryRules: ItemRules<IndentedEntry> = {
  parseItem: (parser) => nested(parser, () => parseEntry(parser)),
  separator: ',',
  annotate: undefined,
};

function parseEntry(parser: Parser): IndentedEntry {
  const { cursor } = parser;
  const { start } = cursor.token.span;
  if (atItem(parser)) {
    return parseItem(parser);
  }
  if (cursor.at(spreadOpener)) {
    return parseSpread(parser);
  }
  if (cursor.at(structComprehensionOpener)) {
    return parseStructComprehension(parser);
  }
  const next = cursor.kindAt(1);
  if (cursor.at('identifier') && next === ':') {
    const name = parser.identifier();
    cursor.advance();
    const value = parseValue(parser, start);
    return { kind: 'FieldInitializer', span: parser.spanFrom(start), name, value };
  }
  if (cursor.at('identifier') && (next === ',' || next === 'lineBreak' || next === 'end')) {
    const name = parser.identifier();
    return { kind: 'FieldInitializer', span: name.span, name, value: undefined };
  }
  if (cursor.at('string') && next === ':') {
    const key = parseKey(parser);
    cursor.advance();
    const value = parseValue(parser, start);
    return { kind: 'QuotedEntry', span: parser.spanFrom(start), key, value };
  }
  if (atLineStart(parser, '-')) {
    const dash = cursor.advance();
    const operand = cursor.advance();
    parser.report(parserDiagnostics.dashGluedToItem({ start, end: operand.span.end }));
    return { kind: 'Invalid', span: parser.spanFrom(dash.span.start) };
  }
  parser.reportExpected(
    "an entry: 'key: value', a name, '...value', '- item' or a struct comprehension",
  );
  return { kind: 'Invalid', span: parser.spanFrom(start) };
}

function parseKey(parser: Parser): StringLiteral {
  const token = parser.cursor.advance();
  const value = token.kind === 'string' ? token.value : '';
  return { kind: 'StringLiteral', span: parser.anchor(token.span), value };
}

/**
 * Whether a `-` opening an item comes next: first on its line, a space or the line's end after it.
 */
function atItem(parser: Parser): boolean {
  return atLineStart(parser, '-') && !gluedToNext(parser);
}

/** Whether `kind` comes next, first on its line. */
function atLineStart(parser: Parser, kind: '-'): boolean {
  const { token } = parser.cursor;
  return token.kind === kind && token.firstOnLine;
}

/** Whether the token at the cursor touches the one after it, as `-1`'s `-` does. */
function gluedToNext(parser: Parser): boolean {
  const { cursor } = parser;
  const next = cursor.peek(1);
  return (
    next.kind !== 'lineBreak' && next.kind !== 'end' && next.span.start === cursor.token.span.end
  );
}

/** `- value`, from its `-`. */
function parseItem(parser: Parser): IndentedItem {
  const { cursor } = parser;
  const { start } = cursor.advance().span;
  const value = parseItemValue(parser, start);
  return { kind: 'IndentedItem', span: parser.spanFrom(start), value };
}

function parseItemValue(parser: Parser, dash: number): IndentedItem['value'] {
  const { cursor } = parser;
  if (endsLine(parser)) {
    return parseBlockValue(parser, dash, undefined);
  }
  if (cursor.at(spreadOpener)) {
    return parseSpread(parser);
  }
  if (cursor.at('-') && !gluedToNext(parser)) {
    parser.report(parserDiagnostics.itemStartingWithDash(cursor.token.span));
  }
  if (startsKeyedValue(parser)) {
    return parseKeyedValue(parser);
  }
  return parseNamedValue(parser, dash) ?? parser.expression();
}

/**
 * Whether `key: value` follows an item's `-`: a name or a String, then `:`. A name whose `:` ends
 * the line is the `T:` of a value below where its case names a type, as `- Point:` does, and a key
 * whose value is the block below where it binds as a pattern's bare name would (`- nested:`).
 */
function startsKeyedValue(parser: Parser): boolean {
  const { cursor } = parser;
  if (cursor.kindAt(1) !== ':') {
    return false;
  }
  if (cursor.at('string')) {
    return true;
  }
  const after = cursor.kindAt(2);
  const opensBlock = after === 'lineBreak' || after === 'end';
  return cursor.at('identifier') && (!opensBlock || bindsInPattern(parser.textOf(cursor.token)));
}

/** `key: value` after an item's `-`, with the entries below it lined up with `key`. */
function parseKeyedValue(parser: Parser): IndentedValue {
  const { cursor } = parser;
  const { start } = cursor.token.span;
  const column = parser.columnOf(cursor.token);
  const { items } = cursor.inBlock(column, () => parseLines(parser, entryRules));
  const entries = checkedEntries(parser, items);
  return {
    kind: 'IndentedValue',
    span: parser.spanFrom(start),
    type: undefined,
    isNew: false,
    entries,
  };
}
