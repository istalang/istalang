/**
 * Declarations and the module (spec §3). Every declaration with members prints them indented
 * under its `:`, one per line, so the braced form `struct Req { id: Int, value: String }` reads as
 * the indented one: the tree doesn't record which was written, and one canonical form is the
 * point. A variant's fields have only the braced form.
 *
 * A docstring stands first in an indented body; a declaration without one takes it on the next
 * line, deeper (§2).
 */

import { builders } from 'prettier/doc';
import {
  type Declaration,
  type DeclarationPart,
  type Documented,
  type FunctionDeclaration,
  type Module,
  membersAsWritten,
  type TypeParameters,
} from '../compiler/syntax/declarations/index.ts';
import type { Annotation } from '../compiler/syntax/items.ts';
import { bodyOf, type SyntaxNode } from '../compiler/syntax/tree/index.ts';
import type { Identifier } from '../compiler/syntax/tree/node.ts';
import { opened } from './expressions/indented-values.ts';
import { annotated, docBelow, functionBody, indentedBody } from './layout/bodies.ts';
import { angled, bracketed, bracketedWhenBroken, itemLines } from './layout/lists.ts';
import type { Printer, Printers } from './printer.ts';
import { constraintsAfterIs } from './types.ts';

const { group, hardline } = builders;

type DeclarationKind =
  | Exclude<Declaration | DeclarationPart, { kind: 'VariableDeclaration' | 'Docstring' }>
  | Module
  | Annotation;

/** `name<T, U>`: what every named declaration starts with. */
function named(printer: Printer, name: Identifier, parameters: TypeParameters): builders.Doc {
  return [printer.print(name), angled(printer, parameters)];
}

function functionDoc(printer: Printer, node: FunctionDeclaration): builders.Doc {
  const header = [
    node.isExtern ? 'extern ' : '',
    node.isAsync ? 'async ' : '',
    'fn ',
    node.owner === undefined ? '' : [printer.print(node.owner), '.'],
    named(printer, node.name, node.typeParameters),
    bracketed(printer, node, ['(', ')'], node.parameters),
    node.returnType === undefined ? '' : [' -> ', printer.print(node.returnType)],
  ];
  const body = bodyOf(printer.tree, node);
  return body === undefined
    ? [header, docBelow(printer, node.doc)]
    : group([header, ':', functionBody(printer, node.doc, body)]);
}

/** `members` indented under the header's `:`, or the docstring alone below a header without. */
function members(
  printer: Printer,
  node: SyntaxNode & Documented,
  items: readonly SyntaxNode[],
): builders.Doc {
  // A comment after the braces' `{` of `struct S { …` ends the header's line.
  const opening = printer.dangling(node);
  return items.length === 0
    ? [opening, docBelow(printer, node.doc)]
    : [':', opening, indentedBody(printer, node.doc, items)];
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const declarationPrinters: Printers<DeclarationKind> = {
  Module: (printer, node) => {
    const items = node.doc === undefined ? node.items : [node.doc, ...node.items];
    // A module without items prints nothing of its own: its comments lead it
    // (comments/comments.ts).
    return items.length === 0 ? '' : [itemLines(printer, items), hardline];
  },
  Annotation: (printer, node) => ['@', printer.print(node.value)],
  FunctionDeclaration: (printer, node) => annotated(printer, node, functionDoc(printer, node)),
  StructDeclaration: (printer, node) =>
    annotated(printer, node, [
      'struct ',
      named(printer, node.name, node.typeParameters),
      members(printer, node, membersAsWritten(node)),
    ]),
  SharedStructDeclaration: (printer, node) =>
    annotated(printer, node, [
      'shared struct ',
      named(printer, node.name, node.typeParameters),
      members(printer, node, membersAsWritten(node)),
    ]),
  ExternStructDeclaration: (printer, node) =>
    annotated(printer, node, [
      'extern ',
      node.isSendable ? 'sendable ' : '',
      'struct ',
      named(printer, node.name, node.typeParameters),
      docBelow(printer, node.doc),
    ]),
  ExternConstantDeclaration: (printer, node) =>
    annotated(printer, node, ['extern ', printer.print(node.name), ': ', printer.print(node.type)]),
  EnumDeclaration: (printer, node) =>
    annotated(printer, node, [
      'enum ',
      named(printer, node.name, node.typeParameters),
      members(printer, node, membersAsWritten(node)),
    ]),
  AssociatedType: (printer, node) =>
    annotated(printer, node, ['type ', printer.print(node.name), ' = ', printer.print(node.type)]),
  RequiredAssociatedType: (printer, node) =>
    annotated(printer, node, [
      'type ',
      printer.print(node.name),
      constraintsAfterIs(printer, node.constraints),
    ]),
  // A variant's fields are its parameters (spec §3.11), so they print as a parameter list.
  Variant: (printer, node) =>
    annotated(printer, node, [
      printer.print(node.name),
      node.fields.length === 0 ? '' : bracketed(printer, node, ['(', ')'], node.fields),
    ]),
  TraitDeclaration: (printer, node) =>
    annotated(printer, node, [
      'trait ',
      named(printer, node.name, node.typeParameters),
      members(printer, node, node.members),
    ]),
  TypeAliasDeclaration: (printer, node) =>
    annotated(printer, node, [
      'type ',
      named(printer, node.name, node.typeParameters),
      ' = ',
      printer.print(node.type),
    ]),
  // Bare names have no broken form, a line break ending them, so a long import breaks in `()`.
  NamedImport: (printer, node) =>
    annotated(printer, node, [
      'import ',
      (node.isParenthesized ? bracketed : bracketedWhenBroken)(
        printer,
        node,
        ['(', ')'],
        node.names,
      ),
      ' from ',
      printer.print(node.path),
    ]),
  ImportedName: (printer, node) =>
    node.alias === undefined
      ? printer.print(node.name)
      : [printer.print(node.name), ' as ', printer.print(node.alias)],
  NamespaceImport: (printer, node) =>
    annotated(printer, node, [
      'import * as ',
      printer.print(node.alias),
      ' from ',
      printer.print(node.path),
    ]),
  TypeParameter: (printer, node) => [
    node.isPack ? '...' : '',
    printer.print(node.name),
    node.memberOf === undefined ? '' : [' in ', printer.print(node.memberOf)],
    constraintsAfterIs(printer, node.constraints),
    node.defaultType === undefined ? '' : [' = ', printer.print(node.defaultType)],
  ],
  DeclaredField: (printer, node) =>
    annotated(printer, node, [
      node.isRest ? '...' : '',
      printer.print(node.name),
      node.type === undefined ? '' : [': ', printer.print(node.type)],
      node.defaultValue === undefined ? '' : [' ', opened(printer, '=', node.defaultValue)],
    ]),
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.
