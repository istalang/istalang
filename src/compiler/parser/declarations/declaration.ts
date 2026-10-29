/**
 * Top-level declarations (§3), dispatched on their first token, and the module that holds them
 * (§3.13).
 *
 * The dispatch table covers the declarations that have a keyword of their own. Functions and
 * `const` are statements as well (a local `fn`, a local `const`). Which item may stand where is
 * decided once, for modules and blocks alike (syntax/placement.ts, parts/items.ts).
 *
 * `struct` and `type` start a declaration only when a name follows: `struct{…}` is an anonymous
 * struct literal, and `type` is a keyword only before a declared name (§2). `shared` is one only
 * before `struct` (§3.18).
 */

import type { Declaration, Module } from '../../syntax/declarations.ts';
import { attachAnnotations } from '../annotations.ts';
import { documentedBy } from '../docstrings.ts';
import { type ItemRules, parseModuleLines } from '../layout/index.ts';
import type { Parser } from '../parser.ts';
import { parseModuleItem } from '../parts/items.ts';
import { parseExtern } from './externs.ts';
import { parseImport } from './imports.ts';
import {
  parseEnum,
  parseSharedStruct,
  parseStruct,
  parseTrait,
  parseTypeAlias,
} from './type-declarations.ts';

type TopLevelKeyword = 'import' | 'struct' | 'enum' | 'trait' | 'extern' | 'type' | 'shared';

const topLevelParselets: Record<TopLevelKeyword, (parser: Parser) => Declaration> = {
  import: parseImport,
  struct: parseStruct,
  enum: parseEnum,
  trait: parseTrait,
  extern: parseExtern,
  type: parseTypeAlias,
  shared: parseSharedStruct,
};

/** A declaration only the top level allows, or undefined if none starts here. */
export function parseTopLevelDeclaration(parser: Parser): Declaration | undefined {
  const keyword = topLevelKeyword(parser);
  return keyword === undefined ? undefined : topLevelParselets[keyword](parser);
}

function topLevelKeyword(parser: Parser): TopLevelKeyword | undefined {
  const { cursor } = parser;
  const { kind } = cursor;
  const named = cursor.kindAt(1) === 'identifier';
  switch (kind) {
    case 'import':
    case 'enum':
    case 'trait':
    case 'extern':
      return kind;
    case 'struct':
      return named ? kind : undefined;
    case 'identifier':
      if (parser.atWord('shared') && cursor.kindAt(1) === 'struct') {
        return 'shared';
      }
      return named && parser.atWord('type') ? 'type' : undefined;
    default:
      return undefined;
  }
}

/** A whole source file: declarations at column 0. */
export function parseModule(parser: Parser): Module {
  const { value: items, doc } = parseModuleLines(parser, moduleRules);
  const { end } = parser.cursor.token.span;
  return { kind: 'Module', span: parser.anchor({ start: 0, end }), items, ...documentedBy(doc) };
}

const moduleRules: ItemRules<Declaration> = {
  parseItem: parseModuleItem,
  annotate: attachAnnotations,
  headsSegments: true,
};
