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
import type { CursorToken } from '../../cursor/index.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import type { Parser } from '../../parser.ts';

/** A head ahead of the cursor, looked over without reading it. */
export interface HeadAhead {
  readonly modifiers: readonly ModifierWord[];
  /** Undefined where it is missing after a keyword modifier. */
  readonly keyword: HeadForm['keyword'] | undefined;
  /** How many tokens it takes, its keyword included. */
  readonly length: number;
}

/** The head starting at the cursor, if one does. */
export function headAhead(parser: Parser): HeadAhead | undefined {
  const modifiers: ModifierWord[] = [];
  for (
    let word = modifierAt(parser, 0);
    word !== undefined;
    word = modifierAt(parser, modifiers.length)
  ) {
    modifiers.push(word);
  }
  const next = parser.cursor.kindAt(modifiers.length);
  if (next === 'fn' || next === 'struct') {
    return { modifiers, keyword: next, length: modifiers.length + 1 };
  }
  return modifiers.some(isKeyword)
    ? { modifiers, keyword: undefined, length: modifiers.length }
    : undefined;
}

/** A head of `form`, from its first modifier through its keyword: its modifiers by group. */
export function parseHead(parser: Parser, form: HeadForm): Modifiers {
  const modifiers: Partial<Record<ModifierGroup, ModifierWord>> = {};
  for (let word = modifierAt(parser, 0); word !== undefined; word = modifierAt(parser, 0)) {
    const { span } = parser.cursor.advance();
    const group = groupIn(form, word);
    const held = group === undefined ? undefined : modifiers[group];
    if (group === undefined) {
      parser.report(parserDiagnostics.misplacedModifier(span, word, form.name));
    } else if (held === word) {
      parser.report(parserDiagnostics.repeatedModifier(span, word));
    } else if (held === undefined) {
      modifiers[group] = word;
    } else {
      parser.report(parserDiagnostics.conflictingModifiers(span, word, held));
    }
  }
  parser.expect(form.keyword);
  // Each word is kept under the group `groupIn` found it in, which holds it.
  return modifiers as Modifiers;
}

/** The modifier the token `ahead` tokens on spells, a keyword or a contextual word. */
function modifierAt(parser: Parser, ahead: number): ModifierWord | undefined {
  const word = wordOf(parser, parser.cursor.peek(ahead));
  return isModifierWord(word) ? word : undefined;
}

function wordOf(parser: Parser, token: CursorToken): string {
  return token.kind === 'identifier' ? parser.textOf(token) : token.kind;
}
