/**
 * The expressions with bodies: braced blocks, `if`, `match` and `select` (spec §4, §8).
 *
 * An `if` chain's `elif` and `else` stand at the indentation of the line the `if` starts on, which
 * is where a line break puts them (parser/layout/). The chain, a statement or a value, stays on
 * one line when it fits a compressed form's width (../layout/compact.ts), as `const size = if n <
 * 10: "small" else: "large"` does; else each clause starts a line.
 *
 * A braced block is one line, `{ a; b }`, only with two items or more, none opening a body: one
 * item needs no braces on one line (§4), and a `;` can't follow a one-line body.
 */

import { builders } from 'prettier/doc';
import type {
  ConditionalBranch,
  Expression,
  ExpressionPart,
  If,
} from '../../compiler/syntax/expressions/index.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { body, indentedBody, opensBody } from '../layout/bodies.ts';
import { compactGroup } from '../layout/compact.ts';
import type { Printer, Printers } from '../printer.ts';

const { group, hardline, ifBreak, indent, join, line, softline } = builders;

type BranchKind = Extract<
  Expression | ExpressionPart,
  {
    kind:
      | 'BlockExpression'
      | 'If'
      | 'ConditionalBranch'
      | 'ElseClause'
      | 'Match'
      | 'MatchCase'
      | 'Select'
      | 'SelectCase';
  }
>;

function branch(printer: Printer, keyword: string, node: ConditionalBranch): builders.Doc {
  return printer.withComments(
    node,
    compactGroup([keyword, ' ', printer.print(node.condition), ':', body(printer, node.body)]),
  );
}

/** An `if` chain, on one line when it fits a compressed form's width, else a clause per line. */
function ifChain(printer: Printer, node: If): builders.Doc {
  const clauses = node.branches.map((each, index) =>
    branch(printer, index === 0 ? 'if' : 'elif', each),
  );
  const elseClause = node.elseClause === undefined ? [] : [printer.print(node.elseClause)];
  return compactGroup(join(line, [...clauses, ...elseClause]));
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const branchPrinters: Printers<BranchKind> = {
  BlockExpression: (printer, node) => {
    const { statements } = node.block;
    if (statements.length === 0) {
      const inside = printer.dangling(node.block);
      return inside === '' ? '{}' : group(['{', indent(inside), softline, '}']);
    }
    const opening = ['{', printer.dangling(node.block)];
    if (statements.length === 1 || statements.some(opensBody)) {
      return [opening, indent([hardline, printer.print(node.block)]), hardline, '}'];
    }
    const items = printer.withComments(
      node.block,
      join(
        [ifBreak('', ';'), line],
        statements.map((statement) => printer.print(statement)),
      ),
    );
    return compactGroup([opening, indent([line, items]), line, '}']);
  },
  If: (printer, node) => ifChain(printer, node),
  ConditionalBranch: () =>
    unreachable('A branch prints with its if chain, which knows its keyword.'),
  ElseClause: (printer, node) => compactGroup(['else:', body(printer, node.body)]),
  Match: (printer, node) => [
    'match ',
    printer.print(node.subject),
    ':',
    indentedBody(printer, undefined, node.cases),
  ],
  MatchCase: (printer, node) =>
    compactGroup([
      'case ',
      printer.print(node.pattern),
      node.guard === undefined ? '' : [' if ', printer.print(node.guard)],
      ':',
      body(printer, node.body),
    ]),
  Select: (printer, node) => [
    node.awaits ? 'await select:' : 'select:',
    printer.dangling(node),
    indentedBody(printer, undefined, [
      ...node.cases,
      ...(node.elseClause === undefined ? [] : [node.elseClause]),
    ]),
  ],
  SelectCase: (printer, node) =>
    compactGroup([
      'case ',
      printer.print(node.future),
      node.binding === undefined ? '' : [' as ', printer.print(node.binding)],
      ':',
      body(printer, node.body),
    ]),
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.
