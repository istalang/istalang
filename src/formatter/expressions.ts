/**
 * Expressions other than literals (literals.ts) and the constructs with bodies (branches.ts).
 *
 * Nothing here breaks a line outside brackets (formatter.md, Layout constraints): an operator, a
 * `.member` or a call's `(` can't start a line, and a lambda's body can't leave its `:`'s line, so
 * those print as one run; only their bracketed parts (lists.ts) break.
 */

import { builders, utils } from 'prettier/doc';
import type {
  Binary,
  Call,
  CallArgument,
  Expression,
  ExpressionPart,
} from '../compiler/syntax/expressions/index.ts';
import { childrenOf, type SyntaxNode } from '../compiler/syntax/tree.ts';
import { angled, bracketed, enclosed, hasComments, hugging, oneLine, tupleList } from './lists.ts';
import type { Printer, Printers } from './printer.ts';

const { group, indent, join, line, softline } = builders;

type ExpressionKind = Exclude<
  Expression | ExpressionPart,
  {
    kind:
      | 'Identifier'
      | 'Missing'
      | 'Invalid'
      | 'IntegerLiteral'
      | 'FloatLiteral'
      | 'DurationLiteral'
      | 'StringLiteral'
      | 'BooleanLiteral'
      | 'NoneLiteral'
      | 'TemplateLiteral'
      | 'TemplateText'
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

/** `?.` where a link reads through an optional (§4); nothing after `->`, which is its own link. */
function link(target: Expression, isOptional: boolean, plain: string): string {
  if (target.kind === 'Dereference' && target.operator === '->') {
    return '';
  }
  return isOptional ? '?.' : plain;
}

/** An operator and the operand after it. */
type Operation = readonly [string, Expression];

/**
 * `a + b - c` as its first operand and the operations after it, so the whole run breaks as one: a
 * left operand that is itself an operation joins the run, unless a comment is placed on it, which
 * must print around it.
 */
function operationChain(printer: Printer, node: Binary): readonly [Expression, ...Operation[]] {
  const operations: Operation[] = [];
  let current: Expression = node;
  while (current.kind === 'Binary' && (current === node || !hasComments(printer, current))) {
    operations.unshift([current.operator, current.right]);
    current = current.left;
  }
  return [current, ...operations];
}

/** Kinds that lay out lines of their own: a run holding one can't stay on one line. */
const linedKinds: ReadonlySet<SyntaxNode['kind']> = new Set([
  'If',
  'Match',
  'Select',
  'BlockExpression',
]);

function laysOutLines(node: SyntaxNode): boolean {
  return linedKinds.has(node.kind) || childrenOf(node).some(laysOutLines);
}

/**
 * Operands and their operators. In brackets a line break may follow an operator, one operand per
 * line once the run doesn't fit. Outside them nothing may break the run, and a line an operand
 * breaks onto keeps the indentation of the run's line, where an `else` must stand (spec §4). A
 * run of plain operands there stays whole on its line rather than breaking one's brackets in the
 * middle of it, which would only move its end; one holding an `if` or a block lets them break.
 */
function operatorRun(
  printer: Printer,
  node: Expression,
  first: Expression,
  operations: readonly Operation[],
): builders.Doc {
  const operands = [first, ...operations.map(([, operand]) => operand)];
  const [firstDoc, ...rest] = operands.map((operand) => printer.print(operand));
  if (printer.inBrackets(node)) {
    return group([
      firstDoc ?? '',
      indent(operations.map(([operator], index) => [' ', operator, line, rest[index] ?? ''])),
    ]);
  }
  const run = [
    firstDoc ?? '',
    operations.map(([operator], index) => [' ', operator, ' ', rest[index] ?? '']),
  ];
  return operands.some(laysOutLines) || utils.willBreak(run) ? run : oneLine(run);
}

/**
 * Kinds of a last argument that keep their opening bracket on the call's line: collections and
 * lambdas, which grow long; a struct literal's few fields read better broken out with the call.
 */
const huggedArguments: ReadonlySet<SyntaxNode['kind']> = new Set([
  'ArrayLiteral',
  'MapLiteral',
  'Comprehension',
]);

function huggable(printer: Printer, argument: CallArgument): boolean {
  const opensBrackets =
    huggedArguments.has(argument.kind) ||
    (argument.kind === 'Lambda' &&
      (argument.body.kind === 'BlockExpression' || huggedArguments.has(argument.body.kind)));
  return opensBrackets && !hasComments(printer, argument);
}

/** A call's arguments, its last hugged when it is a lambda or literal that breaks inside itself. */
function callArguments(printer: Printer, node: Call): builders.Doc {
  const expanded = bracketed(printer, node, ['(', ')'], node.arguments);
  const front = node.arguments.slice(0, -1);
  const last = node.arguments.at(-1);
  // A comment after the `(` prints only where the arguments break out of the call's line.
  if (
    last === undefined ||
    !huggable(printer, last) ||
    printer.dangling(node) !== '' ||
    front.some((argument) => hasComments(printer, argument))
  ) {
    return expanded;
  }
  const printedFront = front.map((argument) => printer.print(argument));
  if (printedFront.some((argument) => utils.willBreak(argument))) {
    return expanded;
  }
  const before = ['(', printedFront.map((argument) => [argument, ', '])];
  return hugging([before, printer.print(last), ')'], expanded);
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const expressionPrinters: Printers<ExpressionKind> = {
  ArrayLiteral: (printer, node) => bracketed(printer, node, ['[', ']'], node.elements),
  MapLiteral: (printer, node) =>
    node.entries.length === 0
      ? group(['[', indent(printer.dangling(node)), softline, ':]'])
      : bracketed(printer, node, ['[', ']'], node.entries),
  MapEntry: (printer, node) => [printer.print(node.key), ': ', printer.print(node.value)],
  Spread: (printer, node) => ['...', printer.print(node.expression)],
  Comprehension: (printer, node) =>
    group([
      '[',
      indent([
        printer.dangling(node),
        softline,
        'for ',
        join(
          ', ',
          node.targets.map((target) => printer.print(target)),
        ),
        ' in ',
        printer.print(node.iterable),
        node.condition === undefined ? '' : [' if ', printer.print(node.condition)],
        ': ',
        printer.print(node.body),
      ]),
      softline,
      ']',
    ]),
  Tuple: (printer, node) => tupleList(printer, node, node.elements),
  Parenthesized: (printer, node) => enclosed(printer, node, ['(', ')'], node.expression),
  StructLiteral: (printer, node) => [
    node.type === undefined ? 'struct' : printer.print(node.type),
    bracketed(printer, node, ['{', '}'], node.items),
  ],
  NewStructLiteral: (printer, node) => [
    'new ',
    printer.print(node.type),
    bracketed(printer, node, ['{', '}'], node.items),
  ],
  FieldInitializer: (printer, node) =>
    node.value === undefined
      ? printer.print(node.name)
      : [printer.print(node.name), ': ', printer.print(node.value)],
  PositionalInitializer: (printer, node) => printer.print(node.value),
  Parameter: (printer, node) => [
    node.isRest ? '...' : '',
    printer.print(node.name),
    node.type === undefined ? '' : [': ', printer.print(node.type)],
    node.defaultValue === undefined ? '' : [' = ', printer.print(node.defaultValue)],
  ],
  Lambda: (printer, node) => [
    node.isAsync ? 'async ' : '',
    'fn',
    node.name === undefined ? '' : [' ', printer.print(node.name)],
    bracketed(printer, node, ['(', ')'], node.parameters),
    node.returnType === undefined ? '' : [' -> ', printer.print(node.returnType)],
    ': ',
    printer.print(node.body),
  ],
  Call: (printer, node) => [
    printer.print(node.callee),
    node.isOptional ? '?.' : '',
    angled(printer, node.typeArguments),
    callArguments(printer, node),
  ],
  NamedArgument: (printer, node) => [printer.print(node.name), ': ', printer.print(node.value)],
  Spawn: (printer, node) => ['spawn ', printer.print(node.call)],
  Reference: (printer, node) => ['&', printer.print(node.expression)],
  MemberAccess: (printer, node) => [
    printer.print(node.target),
    link(node.target, node.isOptional, '.'),
    printer.print(node.member),
  ],
  TupleElement: (printer, node) => [
    printer.print(node.target),
    link(node.target, node.isOptional, '.'),
    String(node.element),
  ],
  Index: (printer, node) => [
    printer.print(node.target),
    node.isOptional ? '?.' : '',
    enclosed(printer, node, ['[', ']'], node.index),
  ],
  Propagate: (printer, node) => [printer.print(node.operand), '?'],
  Unwrap: (printer, node) => [printer.print(node.operand), '!'],
  Dereference: (printer, node) => {
    if (node.operator === '*') {
      return ['*', printer.print(node.operand)];
    }
    return [printer.print(node.operand), node.isOptional ? '?->' : '->'];
  },
  Unary: (printer, node) => [
    node.operator,
    node.operator === 'not' ? ' ' : '',
    printer.print(node.operand),
  ],
  Await: (printer, node) => ['await ', printer.print(node.operand)],
  Binary: (printer, node) => {
    const [first, ...operations] = operationChain(printer, node);
    return operatorRun(printer, node, first ?? node, operations);
  },
  ChainedComparison: (printer, node) => {
    const [first, ...rest] = node.operands;
    const operations = rest.map(
      (operand, index): Operation => [node.operators[index] ?? '', operand],
    );
    return operatorRun(printer, node, first ?? node, operations);
  },
  Is: (printer, node) => [printer.print(node.subject), ' is ', printer.print(node.pattern)],
  Range: (printer, node) => [
    node.start === undefined ? '' : printer.print(node.start),
    node.isInclusive ? '..=' : '..',
    node.end === undefined ? '' : printer.print(node.end),
    node.step === undefined ? '' : [' by ', printer.print(node.step)],
  ],
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.
