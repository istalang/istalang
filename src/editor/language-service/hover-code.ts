/**
 * The code a hover shows for a function and for a declared type, laid out as the formatter lays
 * out source, narrower: a hover's pane is narrower than an editor (`hoverWidth`).
 *
 * - A function shows its signature (signatures/signatures.ts). The formatter takes a function only
 *   with its body, so the signature is formatted with a stand-in body, which is then cut off.
 * - A struct, an enum or a trait shows its declaration: its header as written and its members, a
 *   field, a variant or an associated type as written and a trait's function by its signature, so
 *   no body or docstring shows. Past `shownMembers` members, a comment says how many more there
 *   are.
 * - `…`, which stands for elided text (a default value), is no syntax: it is formatted as a name
 *   absent from the code and put back after.
 * Code the formatter refuses, as where a type reads in a form no source writes, shows as built.
 */

import type { TypeEntity } from '../../compiler/binder/entities.ts';
import type { Checker } from '../../compiler/checker/check.ts';
import { programModule } from '../../compiler/program/program.ts';
import {
  type FunctionDeclaration,
  membersAsWritten,
  typeParametersOf,
} from '../../compiler/syntax/declarations/index.ts';
import { extentIn, type SyntaxNode, type SyntaxTree } from '../../compiler/syntax/tree/index.ts';
import { formatTextWithin } from '../../formatter/format.ts';
import { lineMapOf } from '../../foundation/text/line-map.ts';
import { textOf } from '../../foundation/text/span.ts';
import { signatureOf } from './signatures/signatures.ts';

/** The width hover code keeps within: narrower than source's, as a hover's pane is. */
const hoverWidth = 80;

/** How many members a declared type shows before saying how many more it has. */
const shownMembers = 20;

const elided = '…';

/** `declaration`'s signature, laid out for a hover (banner). */
export function signatureCode(checker: Checker, declaration: FunctionDeclaration): string {
  const { label } = signatureOf(checker, declaration);
  const formatted = formattedCode(`${label}: ${elided}`);
  return formatted === undefined ? label : formatted.replace(standInBody, '');
}

/** The stand-in body a signature is formatted with, and the `:` before it. */
const standInBody = /:\s*…$/u;

/** A declared type's declaration as a hover shows it (banner); undefined for other types. */
export function typeDeclarationCode(checker: Checker, entity: TypeEntity): string | undefined {
  const { declaration } = entity;
  const module = checker.bindings.moduleOf(entity);
  if (module === undefined) {
    return undefined;
  }
  const { tree } = programModule(checker.program, module);
  const members = membersOf(checker, tree, declaration);
  if (members === undefined) {
    return undefined;
  }
  const hidden = members.length - shownMembers;
  const lines = [
    ...members.slice(0, shownMembers),
    ...(hidden > 0 ? [`# ${elided} ${hidden} more`] : []),
  ];
  const header = headerText(tree, declaration);
  const code =
    lines.length === 0 ? header : [`${header}:`, ...lines.map((line) => `  ${line}`)].join('\n');
  return formattedCode(code) ?? code;
}

/** The members of a declared type as source writes them; undefined for a type with none to list. */
function membersOf(
  checker: Checker,
  tree: SyntaxTree,
  declaration: TypeEntity['declaration'],
): readonly string[] | undefined {
  switch (declaration.kind) {
    case 'StructDeclaration':
    case 'SharedStructDeclaration':
    case 'ExternStructDeclaration':
    case 'EnumDeclaration':
      return membersAsWritten(declaration).flatMap((member) =>
        member.kind === 'Invalid' ? [] : [writtenText(tree, member)],
      );
    case 'TraitDeclaration':
      return declaration.members.flatMap((member) => {
        if (member.kind === 'Invalid') {
          return [];
        }
        return member.kind === 'FunctionDeclaration'
          ? [signatureOf(checker, member).label]
          : [writtenText(tree, member)];
      });
    default:
      return undefined;
  }
}

/** A declaration's header as written: its annotations and words through its name and `<…>`. */
function headerText(tree: SyntaxTree, declaration: TypeEntity['declaration']): string {
  const { text } = tree.source;
  const { start } = extentIn(tree, declaration);
  const parameters =
    'typeParameters' in declaration ? typeParametersOf(declaration.typeParameters) : [];
  const last = parameters.at(-1);
  const end =
    last === undefined
      ? extentIn(tree, declaration.name).end
      : text.indexOf('>', extentIn(tree, last).end) + 1;
  return textOf(tree.source, { start, end });
}

/**
 * `node`'s text, its lines after the first indented as deep past its first line's as they were,
 * so the text stands at any indentation.
 */
function writtenText(tree: SyntaxTree, node: SyntaxNode): string {
  const extent = extentIn(tree, node);
  const lines = lineMapOf(tree.source);
  const { column } = lines.positionAt(extent.start);
  const [first = '', ...rest] = textOf(tree.source, extent).split('\n');
  return [first, ...rest.map((line) => `  ${line.slice(Math.min(column, indentOf(line)))}`)].join(
    '\n',
  );
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** `code` formatted within the hover's width, `…` kept (banner); undefined where it is refused. */
function formattedCode(code: string): string | undefined {
  const stand = standInName(code);
  const formatted = formatTextWithin(`${code.replaceAll(elided, stand)}\n`, hoverWidth);
  return formatted?.trimEnd().replaceAll(stand, elided);
}

/** A name `code` doesn't hold, which a value or a field's name may be. */
function standInName(code: string): string {
  let name = 'elided';
  while (code.includes(name)) {
    name = `_${name}`;
  }
  return name;
}
