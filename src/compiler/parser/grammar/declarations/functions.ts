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
 * (syntax/tree/positions.ts).
 */

import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import type { Block } from '../../../syntax/statements/index.ts';
import { headForms, qualifiersOf } from '../../../syntax/tokens/modifiers.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import { parseDocstringBelow } from '../../layout/bodies.ts';
import { documentedBy, type WithDocstring } from '../../layout/docstrings.ts';
import type { Parser } from '../../parser.ts';
import { parseDocumentedStatementBody } from '../parts/blocks.ts';
import { parseParameters } from '../parts/functions.ts';
import { parseFunctionHead } from '../parts/heads.ts';
import { parseTypeParameters } from './type-parameters.ts';

/** Where a function is declared: a module's or a block's item, or a trait's requirement. */
type FunctionPlace = 'item' | 'trait';

/** What a function's body may be: required, optional, or one the host stands in for. */
type FunctionForm = 'defined' | 'requirement' | 'extern';

/** A function declaration in `place`, at its head. */
export function parseFunction(parser: Parser, place: FunctionPlace): FunctionDeclaration {
  const { cursor } = parser;
  const { start } = cursor.token.span;
  const { modifiers, mark } = parseFunctionHead(
    parser,
    headForms[place === 'item' ? 'function' : 'requirement'],
  );
  const isExtern = modifiers.extern !== undefined;
  const form = formOf(place, isExtern);
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
    isExtern,
    qualifiers: qualifiersOf(modifiers),
    mark,
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

function formOf(place: FunctionPlace, isExtern: boolean): FunctionForm {
  if (place === 'trait') {
    return 'requirement';
  }
  return isExtern ? 'extern' : 'defined';
}

/** A module's or a block's function, defined or extern. */
export function parseItemFunction(parser: Parser): FunctionDeclaration {
  return parseFunction(parser, 'item');
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
 * function without one (§2), and where its header ends: before the body. A missing body is reported
 * only for a defined function whose signature is complete: a broken signature has already been
 * reported.
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
