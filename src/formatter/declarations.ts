/**
 * Declarations and the module (spec §3). Every declaration with members prints them indented
 * under its `:`, one per line, so the braced form `struct Req { id: Int; value: String }` reads as
 * the indented one: the tree doesn't record which was written, and one canonical form is the
 * point. A variant's fields have only the braced form.
 *
 * A docstring stands first in an indented body; a declaration without one takes it on the next
 * line, deeper (§2).
 */

import { builders } from 'prettier/doc';
import type { Annotation } from '../compiler/syntax/annotations.ts';
import type {
  Declaration,
  DeclarationPart,
  Documented,
  FunctionDeclaration,
  Module,
  TypeParameters,
} from '../compiler/syntax/declarations.ts';
import type { Identifier } from '../compiler/syntax/node.ts';
import { bodyOf, type SyntaxNode } from '../compiler/syntax/tree.ts';
import { annotated, docBelow, functionBody, indentedBody } from './bodies.ts';
import { angled, bracketed, fieldList, itemLines } from './lists.ts';
import type { Printer, Printers } from './printer.ts';

const { group, hardline, join } = builders;

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
    // A module without items prints nothing of its own: its comments lead it (comments.ts).
    return items.length === 0 ? '' : [itemLines(printer, items), hardline];
  },
  Annotation: (printer, node) => ['@', printer.print(node.value)],
  FunctionDeclaration: (printer, node) => annotated(printer, node, functionDoc(printer, node)),
  StructDeclaration: (printer, node) =>
    annotated(printer, node, [
      'struct ',
      named(printer, node.name, node.typeParameters),
      members(printer, node, node.fields),
    ]),
  SharedStructDeclaration: (printer, node) =>
    annotated(printer, node, [
      'shared struct ',
      named(printer, node.name, node.typeParameters),
      members(printer, node, node.fields),
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
      members(printer, node, node.variants),
    ]),
  Variant: (printer, node) =>
    annotated(printer, node, [
      printer.print(node.name),
      node.fields.length === 0 ? '' : [' ', fieldList(printer, node, node.fields)],
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
  NamedImport: (printer, node) =>
    annotated(printer, node, [
      'import ',
      join(
        ', ',
        node.names.map((name) => printer.print(name)),
      ),
      ' from ',
      printer.print(node.path),
    ]),
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
    node.constraints.length === 0
      ? ''
      : [
          ' is ',
          join(
            ' & ',
            node.constraints.map((constraint) => printer.print(constraint)),
          ),
        ],
    node.defaultType === undefined ? '' : [' = ', printer.print(node.defaultType)],
  ],
  DeclaredField: (printer, node) =>
    annotated(printer, node, [
      printer.print(node.name),
      node.type === undefined ? '' : [': ', printer.print(node.type)],
      node.defaultValue === undefined ? '' : [' = ', printer.print(node.defaultValue)],
    ]),
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.
