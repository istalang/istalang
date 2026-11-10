/**
 * Heads (§2): the modifiers before a function's or a struct's keyword, read in any order
 * (syntax/tokens/modifiers.ts). Every construct with a head reads it here, so each modifier is
 * checked once, wherever it stands.
 *
 * - Where a word may start a head, the parser looks past the modifiers to the keyword before
 *   choosing a construct: `async sendable fn` in a type, `shared extern struct` in a module. A
 *   keyword among them (`async`, `extern`) starts a head even with its own keyword missing, as
 *   nothing else can follow it; a contextual word only where `fn` or `struct` ends the run.
 * - A head starting with a modifier its position's words lack (`sendable fn(x): x` as an operand)
 *   still reaches its construct, past the word tables, so its head reports the stray word as it
 *   does in any other order.
 * - Reading a head keeps the first of two words of a group and reports the second, and reports a
 *   word the head's form doesn't take. The head is read whole either way, so one stray modifier
 *   costs one diagnostic.
 * - A declared function's head may name its mark instead of writing `live` or `ista` (proposal 8,
 *   Rule 3): a mark parameter, `M fn`, or a path to one, `Self.Mode fn`, standing among its
 *   modifiers. Only where a declaration may start is a name read so (`withMark`), and only before
 *   `fn`, so an expression or a type starting with a name never reads as a head.
 */

import { isKeyword } from '../../../syntax/tokens/index.ts';
import {
  groupIn,
  type HeadForm,
  isModifierWord,
  type ModifierGroup,
  type Modifiers,
  type ModifierWord,
} from '../../../syntax/tokens/modifiers.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import { type NamedType, namedTypeText } from '../../../syntax/types/index.ts';
import type { CursorToken } from '../../cursor/index.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import type { Parser } from '../../parser.ts';

/** A head ahead of the cursor, looked over without reading it. */
export interface HeadAhead {
  readonly modifiers: readonly ModifierWord[];
  /** Whether a mark's name stands among them (`withMark`). */
  readonly named: boolean;
  /** Undefined where it is missing after a keyword modifier. */
  readonly keyword: HeadForm['keyword'] | undefined;
  /** How many tokens it takes, its keyword included. */
  readonly length: number;
}

/**
 * The head starting at the cursor, if one does; `withMark` where a declaration may start, whose
 * head may name its mark (the banner).
 */
export function headAhead(parser: Parser, withMark = false): HeadAhead | undefined {
  const { modifiers, named, length } = wordsAhead(parser, withMark);
  const next = parser.cursor.kindAt(length);
  if (next === 'fn' || (next === 'struct' && !named)) {
    return { modifiers, named, keyword: next, length: length + 1 };
  }
  return modifiers.some(isKeyword) && !named
    ? { modifiers, named, keyword: undefined, length }
    : undefined;
}

/** The modifiers, and a mark's name where `withMark`, ahead of the cursor, and how many tokens. */
function wordsAhead(parser: Parser, withMark: boolean): Omit<HeadAhead, 'keyword'> {
  const modifiers: ModifierWord[] = [];
  let length = 0;
  let named = false;
  for (;;) {
    const word = modifierAt(parser, length);
    const name = withMark && word === undefined ? markNameLength(parser, length) : 0;
    if (word !== undefined) {
      modifiers.push(word);
      length += 1;
    } else if (name > 0) {
      named = true;
      length += name;
    } else {
      return { modifiers, named, length };
    }
  }
}

/** A head of `form`, from its first modifier through its keyword: its modifiers by group. */
export function parseHead(parser: Parser, form: HeadForm): Modifiers {
  return readHead(parser, form, false).modifiers;
}

/**
 * A declared function's head of `form`: its modifiers, and the mark it names, if any (the banner).
 */
export function parseFunctionHead(
  parser: Parser,
  form: HeadForm,
): { readonly modifiers: Modifiers; readonly mark: NamedType | undefined } {
  return readHead(parser, form, true);
}

/** A head as read so far: its modifiers by group, and the mark it names. */
interface HeadRead {
  readonly modifiers: Partial<Record<ModifierGroup, ModifierWord>>;
  mark: NamedType | undefined;
}

function readHead(
  parser: Parser,
  form: HeadForm,
  withMark: boolean,
): { readonly modifiers: Modifiers; readonly mark: NamedType | undefined } {
  const head: HeadRead = { modifiers: {}, mark: undefined };
  for (;;) {
    const word = modifierAt(parser, 0);
    if (word !== undefined) {
      readModifier(parser, form, word, head);
    } else if (withMark && markNameLength(parser, 0) > 0) {
      readMark(parser, head);
    } else {
      break;
    }
  }
  parser.expect(form.keyword);
  // Each word is kept under the group `groupIn` found it in, which holds it.
  return { modifiers: head.modifiers as Modifiers, mark: head.mark };
}

/** The modifier `word` at the cursor, kept in `head` unless it repeats or conflicts. */
function readModifier(parser: Parser, form: HeadForm, word: ModifierWord, head: HeadRead): void {
  const { modifiers, mark } = head;
  const { span } = parser.cursor.advance();
  const group = groupIn(form, word);
  const held = group === undefined ? undefined : modifiers[group];
  if (group === undefined) {
    parser.report(parserDiagnostics.misplacedModifier(span, word, form.name));
  } else if (held === word) {
    parser.report(parserDiagnostics.repeatedModifier(span, word));
  } else if (group === 'kind' && mark !== undefined) {
    parser.report(parserDiagnostics.conflictingModifiers(span, word, namedTypeText(mark)));
  } else if (held === undefined) {
    modifiers[group] = word;
  } else {
    parser.report(parserDiagnostics.conflictingModifiers(span, word, held));
  }
}

/** The mark's name at the cursor, kept in `head` unless it names one or writes a kind already. */
function readMark(parser: Parser, head: HeadRead): void {
  const name = parseMarkName(parser);
  const held = head.mark === undefined ? head.modifiers.kind : namedTypeText(head.mark);
  if (held === undefined) {
    head.mark = name;
    return;
  }
  const at = parser.textSpanOf(name.span);
  parser.report(parserDiagnostics.conflictingModifiers(at, namedTypeText(name), held));
}

/**
 * How many tokens a mark's name takes `ahead` tokens on, `M` or `Self.Mode`, where a modifier or
 * `fn` follows it; 0 where none stands there.
 */
function markNameLength(parser: Parser, ahead: number): number {
  const { cursor } = parser;
  let length = 0;
  while (
    cursor.kindAt(ahead + length) === 'identifier' &&
    modifierAt(parser, ahead + length) === undefined
  ) {
    length += 1;
    if (cursor.kindAt(ahead + length) !== '.') {
      break;
    }
    length += 1;
  }
  const after = cursor.kindAt(ahead + length);
  const closes =
    length > 0 &&
    cursor.kindAt(ahead + length - 1) === 'identifier' &&
    (after === 'fn' || modifierAt(parser, ahead + length) !== undefined);
  return closes ? length : 0;
}

/** A mark's name at the cursor, as the type it names. */
function parseMarkName(parser: Parser): NamedType {
  const { start } = parser.cursor.token.span;
  const first = parser.identifier('a mark');
  const rest: Identifier[] = [];
  while (parser.cursor.eat('.') !== undefined) {
    rest.push(parser.identifier('a mark'));
  }
  return {
    kind: 'NamedType',
    span: parser.spanFrom(start),
    path: [first, ...rest],
    typeArguments: [],
  };
}

/** The modifier the token `ahead` tokens on spells, a keyword or a contextual word. */
function modifierAt(parser: Parser, ahead: number): ModifierWord | undefined {
  const word = wordOf(parser, parser.cursor.peek(ahead));
  return isModifierWord(word) ? word : undefined;
}

function wordOf(parser: Parser, token: CursorToken): string {
  return token.kind === 'identifier' ? parser.textOf(token) : token.kind;
}
