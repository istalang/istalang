/**
 * Function declarations (§3.3, §3.7, §3.10): top-level and local functions, static functions
 * declared on a type (`fn Duration.zero()`), trait requirements, and extern functions.
 *
 * The forms differ only in their body. A defined function needs one, a trait's requirement may
 * omit it, and an extern function must not have one: the host implements it. A body written on
 * an extern function is reported but kept, so the tree shows what was written. A function's
 * docstring is the first line of its body, or the line below a function without one (§2).
 *
 * A function's own span covers its header, docstring included; its body, which the tree holds
 * apart, follows it, as a segment of its own for a module's or a trait's function
 * (syntax/positions.ts).
 */

import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { Block } from '../../syntax/statements.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import { documentedBy, type WithDocstring } from '../docstrings.ts';
import { parseDocstringBelow } from '../layout/bodies.ts';
import type { Parser } from '../parser.ts';
import { parseDocumentedStatementBody } from '../parts/blocks.ts';
import { parseFunctionKeyword } from '../parts/functions.ts';
import { parseParameters } from '../parts/parameters.ts';
import { parseTypeParameters } from './type-parameters.ts';

export type FunctionForm = 'defined' | 'requirement' | 'extern';

/** A function declaration of `form`, starting at `fn` or `async`; `start` is where it began. */
export function parseFunction(
  parser: Parser,
  form: FunctionForm,
  start = parser.cursor.token.span.start,
): FunctionDeclaration {
  const { cursor } = parser;
  const isAsync = parseFunctionKeyword(parser);
  const { owner, name } = parseFunctionName(parser);
  const typeParameters = parseTypeParameters(parser);
  const hasParameters = cursor.at('(');
  const parameters = hasParameters ? parseParameters(parser) : missingParameters(parser);
  const returnType = cursor.eat('->') === undefined ? undefined : parser.type();
  const {
    value: body,
    doc,
    headerEnd,
  } = parseFunctionBody(parser, form, {
    start,
    signatureIsComplete: hasParameters,
  });
  const declaration: FunctionDeclaration = {
    kind: 'FunctionDeclaration',
    span: parser.anchor({ start, end: Math.max(start, headerEnd) }),
    isExtern: form === 'extern',
    isAsync,
    owner,
    name,
    typeParameters,
    parameters,
    returnType,
    ...documentedBy(doc),
  };
  if (body !== undefined) {
    parser.addBody(declaration, body);
  }
  return declaration;
}

/** A defined function, top-level or local. */
export function parseDefinedFunction(parser: Parser): FunctionDeclaration {
  return parseFunction(parser, 'defined');
}

/** `name`, or `Type.name` for a static function. */
function parseFunctionName(parser: Parser): {
  owner: Identifier | undefined;
  name: Identifier;
} {
  const { cursor } = parser;
  const first = parser.identifier('a function name');
  if (!(cursor.at('.') && cursor.kindAt(1) === 'identifier')) {
    return { owner: undefined, name: first };
  }
  cursor.advance();
  return { owner: first, name: parser.identifier('a function name') };
}

function missingParameters(parser: Parser): [] {
  parser.reportExpected("'('");
  return [];
}

/**
 * The body after `:`, if any, the function's docstring, first in the body or on the line after a
 * function without one (§2), and where its header ends: before the body. A missing body is reported only for a defined function whose
 * signature is complete: a broken signature has already been reported.
 */
function parseFunctionBody(
  parser: Parser,
  form: FunctionForm,
  { start, signatureIsComplete }: { readonly start: number; readonly signatureIsComplete: boolean },
): WithDocstring<Block | undefined> & { readonly headerEnd: number } {
  const required = form === 'defined' && signatureIsComplete;
  const colon = required ? parser.expect(':') : parser.cursor.eat(':');
  if (colon === undefined) {
    const doc = parseDocstringBelow(parser, start);
    return { value: undefined, doc, headerEnd: parser.cursor.previousEnd };
  }
  const documented = parseDocumentedStatementBody(parser, start, (parse) =>
    parser.inFunctionBody(start, parse),
  );
  if (form === 'extern') {
    parser.report(parserDiagnostics.externWithBody(parser.textSpanOf(documented.value.span)));
  }
  return documented;
}
