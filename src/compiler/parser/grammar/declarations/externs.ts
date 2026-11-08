/**
 * Extern declarations (§3.6, §3.8): what the host implements. After `extern` comes a function, a
 * struct (which may say which handle it is: `shared`, `sendable` or `ephemeral`), or a constant,
 * written `name: Type` with no value. A handle's word is a keyword only right after `extern` (§2),
 * where it always starts a struct. An extern struct's docstring stands on the line below it.
 */

import type {
  ExternConstantDeclaration,
  ExternStructDeclaration,
  FunctionDeclaration,
} from '../../../syntax/declarations/index.ts';
import { type ExternHandle, externHandles } from '../../../syntax/tokens/grammar-words.ts';
import { parseDocstringBelow } from '../../layout/bodies.ts';
import { documentedBy } from '../../layout/docstrings.ts';
import type { Parser } from '../../parser.ts';
import { parseFunction } from './functions.ts';
import { parseTypeParameters } from './type-parameters.ts';

export function parseExtern(
  parser: Parser,
): FunctionDeclaration | ExternStructDeclaration | ExternConstantDeclaration {
  const { cursor } = parser;
  const { start } = cursor.advance().span;
  const { kind } = cursor;
  if (kind === 'fn' || kind === 'async') {
    return parseFunction(parser, 'extern', start);
  }
  const handle = externHandles.find((word) => parser.atWord(word));
  if (handle !== undefined || kind === 'struct') {
    return parseExternStruct(parser, start, handle);
  }
  const name = parser.identifier('a function, a struct or a constant name');
  const type = parser.expect(':') === undefined ? parser.placeholder() : parser.type();
  return { kind: 'ExternConstantDeclaration', span: parser.spanFrom(start), name, type };
}

function parseExternStruct(
  parser: Parser,
  start: number,
  handle: ExternHandle | undefined,
): ExternStructDeclaration {
  if (handle !== undefined) {
    parser.cursor.advance();
  }
  parser.expect('struct');
  const name = parser.identifier('a type name');
  const typeParameters = parseTypeParameters(parser);
  const doc = parseDocstringBelow(parser, start);
  const span = parser.spanFrom(start);
  return {
    kind: 'ExternStructDeclaration',
    span,
    handle,
    name,
    typeParameters,
    ...documentedBy(doc),
  };
}
