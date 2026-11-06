/**
 * Top-level declarations (§3), dispatched on their first token, and the module that holds them
 * (§3.13).
 *
 * The dispatch tables cover the declarations that have a word of their own (`declarationWords`,
 * syntax/grammar-words.ts). Functions and `const` are statements as well (a local `fn`, a local
 * `const`). Which item may stand where is decided once, for modules and blocks alike
 * (syntax/placement.ts, grammar/parts/blocks.ts).
 *
 * `struct` and `type` start a declaration only when a name follows: `struct{…}` is an anonymous
 * struct literal, and `type` is a keyword only before a declared name (§2). `shared` is one only
 * before `struct` (§3.18).
 */

import type { Declaration, Module } from '../../../syntax/declarations/index.ts';
import type { DeclarationWord } from '../../../syntax/grammar-words.ts';
import type { CursorKind } from '../../cursor/index.ts';
import { attachAnnotations } from '../../layout/annotations.ts';
import { documentedBy } from '../../layout/docstrings.ts';
import { type ItemRules, parseModuleLines } from '../../layout/index.ts';
import type { Parser } from '../../parser.ts';
import { parseModuleItem } from '../parts/blocks.ts';
import {
  followsModifier,
  type StartParselets,
  type WordParselets,
  wordParseletAt,
} from '../word-parselets.ts';
import { parseExtern } from './externs.ts';
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
  extern: parseExtern,
} satisfies StartParselets<DeclarationWord, DeclarationParselet>;

const wordParselets = {
  type: (parser) => (namedNext(parser) ? parseTypeAlias(parser) : undefined),
  shared: (parser) => (followsModifier(parser, 'shared') ? parseSharedStruct(parser) : undefined),
} satisfies WordParselets<DeclarationWord, DeclarationParselet>;

/** A declaration only the top level allows, or undefined if none starts here. */
export function parseTopLevelDeclaration(parser: Parser): Declaration | undefined {
  const parselet = topLevelParselets[parser.cursor.kind] ?? wordParseletAt(parser, wordParselets);
  return parselet?.(parser);
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
