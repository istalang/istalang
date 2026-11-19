/**
 * Extern declarations (§17.2, §19.2): what the host implements. An extern's head holds `extern`
 * among its modifiers (../parts/heads.ts), before a function's `fn` or a struct's `struct`; a
 * struct's may say which handle it is: `shared`, `sendable` or `live`. A constant is
 * `extern name: Type`, with no value. An extern struct's docstring stands on the line below it, or
 * in its body, which declares only associated types.
 */

import type {
  ExternConstantDeclaration,
  ExternStructDeclaration,
} from '../../../syntax/declarations/index.ts';
import { headForms } from '../../../syntax/tokens/modifiers.ts';
import { documentedBy } from '../../layout/docstrings.ts';
import type { Parser } from '../../parser.ts';
import { parseHead } from '../parts/heads.ts';
import { parseExternStructMembers } from './type-declarations.ts';
import { parseTypeParameters } from './type-parameters.ts';

/** `extern name: Type`, at `extern`. */
export function parseExternConstant(parser: Parser): ExternConstantDeclaration {
  const { start } = parser.cursor.advance().span;
  const name = parser.identifier('a function, a struct or a constant name');
  const type = parser.expect(':') === undefined ? parser.placeholder() : parser.type();
  return { kind: 'ExternConstantDeclaration', span: parser.spanFrom(start), name, type };
}

/** An extern struct, at its head. */
export function parseExternStruct(parser: Parser): ExternStructDeclaration {
  const { start } = parser.cursor.token.span;
  const { handle } = parseHead(parser, headForms.externStruct);
  const name = parser.identifier('a type name');
  const typeParameters = parseTypeParameters(parser);
  const { value: members, doc } = parseExternStructMembers(parser, start);
  const span = parser.spanFrom(start);
  return {
    kind: 'ExternStructDeclaration',
    span,
    handle,
    name,
    typeParameters,
    ...members,
    ...documentedBy(doc),
  };
}
