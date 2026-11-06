/**
 * Patterns (spec §3.11, §3.15), printed as written: a struct pattern's braces hold a comma list
 * like a struct literal's (`Pair{first, second as s}`), which may break as brackets do, and a
 * parameter's `{…}` stays the short form of `struct{…}` it was written as (§3.3).
 */

import { builders } from 'prettier/doc';
import type { Pattern, PatternPart, StructPattern } from '../compiler/syntax/patterns.ts';
import { angled, bracketed, enclosed, tupleList } from './lists.ts';
import type { Printer, Printers } from './printer.ts';

const { join } = builders;

type PatternKind = Exclude<Pattern | PatternPart, { kind: 'Missing' | 'Invalid' }>;

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const patternPrinters: Printers<PatternKind> = {
  WildcardPattern: () => '_',
  NamePattern: (printer, node) => [
    join(
      '.',
      node.path.map((name) => printer.print(name)),
    ),
    angled(printer, node.typeArguments),
  ],
  LiteralPattern: (printer, node) => printer.print(node.value),
  TuplePattern: (printer, node) => tupleList(printer, node, node.elements),
  ParenthesizedPattern: (printer, node) => enclosed(printer, node, ['(', ')'], node.pattern),
  StructPattern: (printer, node) => [
    structHead(printer, node),
    bracketed(
      printer,
      node,
      ['{', '}'],
      [...node.fields, ...(node.rest === undefined ? [] : [node.rest])],
    ),
  ],
  BindFieldPattern: (printer, node) => [
    printer.print(node.field),
    node.alias === undefined ? '' : [' as ', printer.print(node.alias)],
  ],
  CompareFieldPattern: (printer, node) => [
    printer.print(node.field),
    ` ${node.operator} `,
    printer.print(node.value),
  ],
  NestedFieldPattern: (printer, node) => [
    printer.print(node.field),
    ' is ',
    printer.print(node.pattern),
  ],
  OrPattern: (printer, node) =>
    join(
      ' | ',
      node.alternatives.map((alternative) => printer.print(alternative)),
    ),
  ArrayPattern: (printer, node) => bracketed(printer, node, ['[', ']'], node.elements),
  RestPattern: (printer, node) => ['...', printer.print(node.target)],
  RangePattern: (printer, node) => [
    node.start === undefined ? '' : printer.print(node.start),
    node.isInclusive ? '..=' : '..',
    node.end === undefined ? '' : printer.print(node.end),
  ],
  AsPattern: (printer, node) => [printer.print(node.pattern), ' as ', printer.print(node.name)],
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/**
 * What names a struct pattern's struct: its type, `struct`, or nothing in a parameter's short form.
 */
function structHead(printer: Printer, node: StructPattern): builders.Doc {
  if (node.type !== undefined) {
    return printer.print(node.type);
  }
  return node.isShort ? '' : 'struct';
}
