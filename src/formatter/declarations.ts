/**
 * Declarations and the module (spec §5.1). A declaration with members prints them in braces,
 * `struct Req { id: Int, value: String }`, when that line fits a compressed form's width
 * (layout/compact.ts), else indented under its `:`, one per line: the tree doesn't record which
 * was written, and one canonical form per width is the point. A variant's fields are its parameters, listed in parentheses as a function's are.
 *
 * A docstring stands first in an indented body; a declaration without one takes it on the next
 * line, deeper (§3.2).
 */

import { builders } from 'prettier/doc';
import {
  type Declaration,
  type DeclarationPart,
  type Documented,
  type FunctionDeclaration,
  functionWords,
  type ImportDeclaration,
  type ImportItem,
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
import { importBlock } from './imports.ts';
import { annotated, docBelow, functionBody, indentedBody } from './layout/bodies.ts';
import { bracedOrIndented, compactGroup } from './layout/compact.ts';
import { angled, bracketed, itemLines, keepsItsLines, spacedDeclaration } from './layout/lists.ts';
import type { Printer, Printers } from './printer.ts';
import { constraintsAfterIs } from './types.ts';

const { hardline, join } = builders;

type DeclarationKind =
  | Exclude<
      Declaration | DeclarationPart,
      { kind: 'VariableDeclaration' | 'Docstring' | ImportDeclaration['kind'] | ImportItem['kind'] }
    >
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
    `${functionWords(node)} `,
    node.owner === undefined ? '' : [printer.print(node.owner), '.'],
    named(printer, node.name, node.typeParameters),
    bracketed(printer, node, ['(', ')'], node.parameters),
    node.returnType === undefined ? '' : [' -> ', printer.print(node.returnType)],
  ];
  const body = bodyOf(printer.tree, node);
  return body === undefined
    ? [marked, header, docBelow(printer, node.doc)]
    : [marked, compactGroup([header, ':', functionBody(printer, node.doc, body)])];
}

/**
 * `members` in braces, `{ a: Int, b: Int }`, when that line fits a compressed form's width, else
 * indented under the header's `:`; or the docstring alone below a header without members.
 */
function members(
  printer: Printer,
  node: SyntaxNode & Documented,
  items: readonly SyntaxNode[],
): builders.Doc {
  if (items.length === 0) {
    return [printer.dangling(node), docBelow(printer, node.doc)];
  }
  // A docstring has no place on one line, nor do the comments and blank lines `keepsItsLines` finds.
  if (node.doc !== undefined || keepsItsLines(printer, node, items)) {
    // A comment after the braces' `{` of `struct S { …` ends the header's line.
    return [':', printer.dangling(node), indentedBody(printer, node.doc, items)];
  }
  const docs = items.map((item) => printer.print(item));
  return bracedOrIndented({
    before: '',
    braced: [' { ', join(', ', docs), ' }'],
    header: ':',
    rows: (newline) => join(newline, docs),
  });
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const declarationPrinters: Printers<DeclarationKind> = {
  Module: (printer, node) => {
    const imports = node.items.filter((item) => item.kind === 'ImportDeclaration');
    const others = node.items.filter((item) => item.kind !== 'ImportDeclaration');
    const sections = [
      node.doc === undefined ? [] : [printer.print(node.doc)],
      imports.length === 0 ? [] : [importBlock(printer, imports)],
      others.length === 0 ? [] : [itemLines(printer, others)],
    ].flat();
    // A module without items prints nothing of its own: its comments lead it
    // (comments/comments.ts).
    return sections.length === 0 ? '' : [join([hardline, hardline], sections), hardline];
  },
  Annotation: (printer, node) => ['@', printer.print(node.value)],
  FunctionDeclaration: (printer, node) =>
    spacedDeclaration(node, annotated(printer, node, functionDoc(printer, node))),
  StructDeclaration: (printer, node) =>
    spacedDeclaration(
      node,
      annotated(printer, node, [
        'struct ',
        named(printer, node.name, node.typeParameters),
        members(printer, node, membersAsWritten(node)),
      ]),
    ),
  SharedStructDeclaration: (printer, node) =>
    spacedDeclaration(
      node,
      annotated(printer, node, [
        'shared struct ',
        named(printer, node.name, node.typeParameters),
        members(printer, node, membersAsWritten(node)),
      ]),
    ),
  ExternStructDeclaration: (printer, node) =>
    spacedDeclaration(
      node,
      annotated(printer, node, [
        modifiersText({ extern: 'extern', handle: node.handle }),
        'struct ',
        named(printer, node.name, node.typeParameters),
        members(printer, node, membersAsWritten(node)),
      ]),
    ),
  ExternConstantDeclaration: (printer, node) =>
    annotated(printer, node, ['extern ', printer.print(node.name), ': ', printer.print(node.type)]),
  ContextConstantDeclaration: (printer, node) =>
    annotated(printer, node, [
      'ista const ',
      printer.print(node.name),
      node.type === undefined ? '' : [': ', printer.print(node.type)],
      ' ',
      opened(printer, '=', node.initializer),
    ]),
  EnumDeclaration: (printer, node) =>
    spacedDeclaration(
      node,
      annotated(printer, node, [
        'enum ',
        named(printer, node.name, node.typeParameters),
        members(printer, node, membersAsWritten(node)),
      ]),
    ),
  AssociatedType: (printer, node) =>
    annotated(printer, node, ['type ', printer.print(node.name), ' = ', printer.print(node.type)]),
  RequiredAssociatedType: (printer, node) =>
    annotated(printer, node, [
      'type ',
      printer.print(node.name),
      node.memberOf === undefined ? '' : [' in ', printer.print(node.memberOf)],
      constraintsAfterIs(printer, node.constraints),
    ]),
  // A variant's fields are its parameters (spec §5.3), so they print as a parameter list; one
  // without fields is its name alone, but for comments its parentheses hold.
  Variant: (printer, node) =>
    annotated(printer, node, [
      printer.print(node.name),
      node.fields.length === 0 && printer.dangling(node) === ''
        ? ''
        : bracketed(printer, node, ['(', ')'], node.fields),
    ]),
  TraitDeclaration: (printer, node) =>
    spacedDeclaration(
      node,
      annotated(printer, node, [
        'trait ',
        named(printer, node.name, node.typeParameters),
        members(printer, node, node.members),
      ]),
    ),
  TypeAliasDeclaration: (printer, node) =>
    annotated(printer, node, [
      'type ',
      named(printer, node.name, node.typeParameters),
      ' = ',
      printer.print(node.type),
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
