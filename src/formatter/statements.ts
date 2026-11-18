/**
 * Statements and blocks (spec §3.4, §4, §7). A block's statements stand one per line: `;` parts
 * statements only inside braces (expressions/branches.ts), so a block never prints them on one
 * line.
 *
 * `hold _ = x` is stored as `hold const _ = x` (syntax/statements/index.ts), and prints in the
 * short form it was most likely written in.
 */

import { builders } from 'prettier/doc';
import type {
  Block,
  Statement,
  StatementPart,
  VariableDeclaration,
} from '../compiler/syntax/statements/index.ts';
import type { SyntaxNode } from '../compiler/syntax/tree/index.ts';
import type { Identifier } from '../compiler/syntax/tree/node.ts';
import { opened } from './expressions/indented-values.ts';
import { annotated, body, indentedBlock } from './layout/bodies.ts';
import { compactGroup } from './layout/compact.ts';
import { itemLines } from './layout/lists.ts';
import type { Printer, Printers } from './printer.ts';

const { join } = builders;

type StatementKind = Exclude<Statement | StatementPart | Block, { kind: 'FunctionDeclaration' }>;

function isHeldWildcard(node: VariableDeclaration): boolean {
  const [only, ...rest] = node.targets;
  return (
    node.hold !== undefined &&
    !node.isMutable &&
    node.type === undefined &&
    only?.kind === 'WildcardPattern' &&
    rest.length === 0
  );
}

/** `let ` or `const `, which `hold _` leaves out. */
function declarationKeyword(node: VariableDeclaration): string {
  if (isHeldWildcard(node)) {
    return '';
  }
  return node.isMutable ? 'let ' : 'const ';
}

function label(printer: Printer, name: Identifier | undefined): builders.Doc {
  return name === undefined ? '' : [printer.print(name), ': '];
}

function jump(printer: Printer, keyword: string, target: SyntaxNode | undefined): builders.Doc {
  return target === undefined ? keyword : opened(printer, keyword, target);
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const statementPrinters: Printers<StatementKind> = {
  Block: (printer, node) => itemLines(printer, node.statements),
  ExpressionStatement: (printer, node) => annotated(printer, node, printer.print(node.expression)),
  VariableDeclaration: (printer, node) =>
    annotated(printer, node, [
      node.hold === undefined ? '' : [printer.print(node.hold), ' '],
      node.isTransient ? 'transient ' : '',
      declarationKeyword(node),
      join(
        ', ',
        node.targets.map((target) => printer.print(target)),
      ),
      node.type === undefined ? '' : [': ', printer.print(node.type)],
      ' ',
      opened(printer, '=', node.initializer),
    ]),
  Hold: (printer, node) =>
    // `hold(` takes no line break (parser), so no comment can stand in it, and it never breaks.
    node.label === undefined ? 'hold' : ['hold(', printer.print(node.label), ')'],
  Assignment: (printer, node) =>
    annotated(printer, node, [
      join(
        ', ',
        node.targets.map((target) => printer.print(target)),
      ),
      ' ',
      opened(printer, node.operator, node.value),
    ]),
  Return: (printer, node) => annotated(printer, node, jump(printer, 'return', node.value)),
  Break: (printer, node) => annotated(printer, node, jump(printer, 'break', node.label)),
  Continue: (printer, node) => annotated(printer, node, jump(printer, 'continue', node.label)),
  For: (printer, node) =>
    annotated(
      printer,
      node,
      compactGroup([
        label(printer, node.label),
        'for ',
        join(
          ', ',
          node.targets.map((target) => printer.print(target)),
        ),
        ' in ',
        printer.print(node.iterable),
        ':',
        body(printer, node.body),
      ]),
    ),
  FieldLoop: (printer, node) =>
    annotated(
      printer,
      node,
      compactGroup([
        label(printer, node.label),
        'for ',
        printer.print(node.header),
        ':',
        body(printer, node.body),
      ]),
    ),
  While: (printer, node) =>
    annotated(
      printer,
      node,
      compactGroup([
        label(printer, node.label),
        'while ',
        printer.print(node.condition),
        ':',
        body(printer, node.body),
      ]),
    ),
  LabelledBlock: (printer, node) =>
    annotated(printer, node, [printer.print(node.label), ':', indentedBlock(printer, node.body)]),
  Drop: (printer, node) => annotated(printer, node, ['drop ', printer.print(node.value)]),
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.
