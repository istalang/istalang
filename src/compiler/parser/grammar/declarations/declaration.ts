/**
 * Top-level declarations (§5.1), dispatched on their first token, and the module that holds them
 * (§13.1).
 *
 * The dispatch tables cover the declarations that have a word of their own (`declarationWords`,
 * syntax/tokens/grammar-words.ts). Functions and `const` are statements as well (a local `fn`, a
 * local `const`). Which item may stand where is decided once, for modules and blocks alike
 * (syntax/items.ts, grammar/parts/blocks.ts).
 *
 * `struct` and `type` start a declaration only when a name follows: `struct{…}` is an anonymous
 * struct literal, and `type` is a keyword only before a declared name (§2.2). An extern's and a
 * shared struct's head start with any of their modifiers, so `shared` and a handle are keywords
 * only before a head's `struct` or `fn` (../parts/heads.ts), and the keyword ending the head, past
 * them, chooses the declaration. A modifier before `const` starts a context constant,
 * `ista const`, whichever word it is, so a wrong one costs one diagnostic.
 */

import type {
  ContextConstantDeclaration,
  Declaration,
  Module,
} from '../../../syntax/declarations/index.ts';
import type { DeclarationWord } from '../../../syntax/tokens/grammar-words.ts';
import {
  groupIn,
  type HeadForm,
  headForms,
  type ModifierWord,
} from '../../../syntax/tokens/modifiers.ts';
import type { CursorKind } from '../../cursor/index.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import { attachAnnotations } from '../../layout/annotations.ts';
import { documentedBy } from '../../layout/docstrings.ts';
import { type ItemRules, parseModuleLines } from '../../layout/index.ts';
import type { Parser } from '../../parser.ts';
import { parseModuleItem } from '../parts/blocks.ts';
import { headAhead, parseHead } from '../parts/heads.ts';
import { type StartParselets, type WordParselets, wordParseletAt } from '../word-parselets.ts';
import { parseExternConstant, parseExternStruct } from './externs.ts';
import { parseFunction } from './functions.ts';
import { parseImport } from './imports.ts';
import {
  parseEnum,
  parseSharedStruct,
  parseStruct,
  parseTrait,
  parseTypeAlias,
} from './type-declarations.ts';

/** A declaration at its word, or undefined, with nothing consumed, where the word starts none. */
type DeclarationParselet = (parser: Parser) => Declaration | undefined;

const topLevelParselets: Partial<Record<CursorKind, DeclarationParselet>> = {
  import: parseImport,
  struct: (parser) => (namedNext(parser) ? parseStruct(parser) : undefined),
  enum: parseEnum,
  trait: parseTrait,
  extern: parseModified,
} satisfies StartParselets<DeclarationWord, DeclarationParselet>;

const wordParselets = {
  type: (parser) => (namedNext(parser) ? parseTypeAlias(parser) : undefined),
  shared: parseModified,
} satisfies WordParselets<DeclarationWord, DeclarationParselet>;

/**
 * A declaration whose head holds modifiers, at the first, whichever it is: an extern function,
 * struct or constant, or a struct. Undefined, with nothing consumed, where no head starts there
 * (`shared = 1`) or it is a statement's: a function's, its mark a name's (`M fn`) included, which
 * the statements' parser tells from a lambda's, as it does any function's.
 */
function parseModified(parser: Parser): Declaration | undefined {
  const head = headAhead(parser, true);
  if (head === undefined || head.modifiers.length === 0) {
    return undefined;
  }
  const { modifiers, keyword } = head;
  if (keyword === 'const') {
    return parseContextConstant(parser);
  }
  if (modifiers.includes('extern')) {
    return parseExtern(parser, modifiers, keyword);
  }
  if (keyword !== 'struct') {
    return undefined;
  }
  return modifiers.includes('shared') ? parseSharedStruct(parser) : parseStruct(parser);
}

/** `ista const name: T = value` (§7.1), at its head, whose kind is `ista` unless reported. */
function parseContextConstant(parser: Parser): ContextConstantDeclaration {
  const { cursor } = parser;
  const { start } = cursor.token.span;
  const { kind } = parseHead(parser, headForms.contextConstant);
  if (kind === 'live') {
    parser.report(
      parserDiagnostics.contextConstantWord(parser.textSpanOf(parser.spanFrom(start)), kind),
    );
  }
  const name = parser.identifier('a name');
  const type = cursor.eat(':') === undefined ? undefined : parser.type();
  const initializer = parser.expect('=') === undefined ? parser.placeholder() : parser.value(start);
  return {
    kind: 'ContextConstantDeclaration',
    span: parser.spanFrom(start),
    name,
    type,
    initializer,
  };
}

/** An extern, at the first of `modifiers`, which `keyword` may end. */
function parseExtern(
  parser: Parser,
  modifiers: readonly ModifierWord[],
  keyword: HeadForm['keyword'] | undefined,
): Declaration {
  if (keyword === undefined && modifiers.length === 1) {
    return parseExternConstant(parser);
  }
  return (keyword ?? keywordWithout(modifiers)) === 'fn'
    ? parseFunction(parser, 'item')
    : parseExternStruct(parser);
}

/**
 * The keyword an extern's head misses: `fn` after words only a function takes, `struct` after a
 * handle, whether a function could take it too (`extern live`).
 */
function keywordWithout(modifiers: readonly ModifierWord[]): HeadForm['keyword'] {
  const takes = (form: HeadForm) => modifiers.every((word) => groupIn(form, word) !== undefined);
  return takes(headForms.function) && !takes(headForms.externStruct) ? 'fn' : 'struct';
}

/**
 * A declaration only the top level allows, or undefined if none starts here. A head may start with
 * any modifier, so one no table holds starts one too (`async extern fn`).
 */
export function parseTopLevelDeclaration(parser: Parser): Declaration | undefined {
  const parselet =
    topLevelParselets[parser.cursor.kind] ?? wordParseletAt(parser, wordParselets) ?? parseModified;
  return parselet(parser);
}

/** Whether a name follows the word at the cursor. */
function namedNext(parser: Parser): boolean {
  return parser.cursor.kindAt(1) === 'identifier';
}

/** A whole source file: declarations at column 0. */
export function parseModule(parser: Parser): Module {
  const { value: items, doc } = parseModuleLines(parser, moduleRules);
  const { end } = parser.cursor.token.span;
  return { kind: 'Module', span: parser.anchor({ start: 0, end }), items, ...documentedBy(doc) };
}

const moduleRules: ItemRules<Declaration> = {
  parseItem: parseModuleItem,
  separator: ';',
  annotate: attachAnnotations,
  headsSegments: true,
};
