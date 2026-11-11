/**
 * Declarations and the module (spec §3). Every declaration with members prints them indented
 * under its `:`, one per line, so the braced form `struct Req { id: Int, value: String }` reads as
 * the indented one: the tree doesn't record which was written, and one canonical form is the
 * point. A variant's fields are its parameters, listed in parentheses as a function's are.
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
import { modifiersAroundMark, modifiersText } from '../compiler/syntax/tokens/modifiers.ts';
import { bodyOf, type SyntaxNode } from '../compiler/syntax/tree/index.ts';
import type { Identifier } from '../compiler/syntax/tree/node.ts';
import { namedTypeText } from '../compiler/syntax/types/index.ts';
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
  const modifiers = { extern: node.isExtern ? 'extern' : undefined, ...node.qualifiers } as const;
  const [beforeMark, afterMark] = modifiersAroundMark(modifiers);
  // A named mark is a node whose comments, written before the head, print before all its words,
  // ahead of the group a body may break.
  const marked =
    node.mark === undefined
      ? modifiersText(modifiers)
      : printer.withComments(node.mark, [beforeMark, namedTypeText(node.mark), ' ', afterMark]);
  const header = [
    'fn ',
    node.owner === undefined ? '' : [printer.print(node.owner), '.'],
    named(printer, node.name, node.typeParameters),
    bracketed(printer, node, ['(', ')'], node.parameters),
    node.returnType === undefined ? '' : [' -> ', printer.print(node.returnType)],
  ];
  const body = bodyOf(printer.tree, node);
  return body === undefined
    ? [marked, header, docBelow(printer, node.doc)]
    : [marked, group([header, ':', functionBody(printer, node.doc, body)])];
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
      modifiersText({ extern: 'extern', handle: node.handle }),
      'struct ',
      named(printer, node.name, node.typeParameters),
      members(printer, node, membersAsWritten(node)),
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
      node.memberOf === undefined ? '' : [' in ', printer.print(node.memberOf)],
      constraintsAfterIs(printer, node.constraints),
    ]),
  // A variant's fields are its parameters (spec §3.11), so they print as a parameter list; one
  // without fields is its name alone, but for comments its parentheses hold.
  Variant: (printer, node) =>
    annotated(printer, node, [
      printer.print(node.name),
      node.fields.length === 0 && printer.dangling(node) === ''
        ? ''
        : bracketed(printer, node, ['(', ')'], node.fields),
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
    node.variance === undefined ? '' : [node.variance, ' '],
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
