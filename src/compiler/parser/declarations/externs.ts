/**
 * Extern declarations (§3.6, §3.8): what the host implements. After `extern` comes a function, a
 * struct (which may be `sendable`), or a constant, written `name: Type` with no value.
 * `sendable` is a keyword only right after `extern` (§2). An extern struct's docstring stands on
 * the line below it.
 */

import type {
  ExternConstantDeclaration,
  ExternStructDeclaration,
  FunctionDeclaration,
} from '../../syntax/declarations/index.ts';
import { documentedBy } from '../docstrings.ts';
import { parseDocstringBelow } from '../layout/bodies.ts';
import type { Parser } from '../parser.ts';
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
  const isSendable = parser.atWord('sendable');
  if (isSendable || kind === 'struct') {
    return parseExternStruct(parser, start, isSendable);
  }
  const name = parser.identifier('a function, a struct or a constant name');
  const type = parser.expect(':') === undefined ? parser.placeholder() : parser.type();
  return { kind: 'ExternConstantDeclaration', span: parser.spanFrom(start), name, type };
}

function parseExternStruct(
  parser: Parser,
  start: number,
  isSendable: boolean,
): ExternStructDeclaration {
  if (isSendable) {
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
    isSendable,
    name,
    typeParameters,
    ...documentedBy(doc),
  };
}
