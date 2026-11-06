/**
 * Types (spec §2, §3). An anonymous struct type prints as its braces alone: in a type position
 * `struct` before `{` changes nothing (§3.1), and the indented field block under a field is sugar
 * for the same type, so braces are the one spelling. A struct constraint (§3.5) keeps its
 * `struct`, which makes it one, and prints bare when it has no entries: `struct` and `struct {}`
 * are the same constraint. A mapped entry prints its parameter as a member type parameter does,
 * `[F in keyof S]: T` (§3.1). A type `match`'s cases stand on lines of their own, as a `match`
 * expression's do; a case's type follows its colon on the same line while it fits, indented below
 * otherwise (§3.17).
 */

import { builders } from 'prettier/doc';
import type { ConstraintNode, TypeNode, TypePart } from '../compiler/syntax/types/index.ts';
import { annotated, indentedBody } from './bodies.ts';
import { angled, bracketed, enclosed, fieldList, tupleList } from './lists.ts';
import type { Printer, Printers } from './printer.ts';

const { group, indent, join, line } = builders;

type TypeKind = Exclude<TypeNode | TypePart, { kind: 'Missing' | 'Invalid' }>;

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const typePrinters: Printers<TypeKind> = {
  NamedType: (printer, node) => [
    join(
      '.',
      node.path.map((name) => printer.print(name)),
    ),
    angled(printer, node.typeArguments),
  ],
  OptionalType: (printer, node) => [printer.print(node.inner), '?'],
  TupleType: (printer, node) => tupleList(printer, node, node.elements),
  ParenthesizedType: (printer, node) => enclosed(printer, node, ['(', ')'], node.inner),
  FunctionType: (printer, node) => [
    node.isSendable ? 'sendable ' : '',
    node.isAsync ? 'async ' : '',
    'fn',
    bracketed(printer, node, ['(', ')'], node.parameters),
    node.returnType === undefined ? '' : [' -> ', printer.print(node.returnType)],
  ],
  RestType: (printer, node) => ['...', printer.print(node.type)],
  AnyType: (printer, node) => [
    'any ',
    join(
      ' & ',
      node.traits.map((trait) => printer.print(trait)),
    ),
  ],
  StructType: (printer, node) => fieldList(printer, node, node.fields),
  FieldDeclaration: (printer, node) =>
    annotated(printer, node, [printer.print(node.name), ': ', printer.print(node.type)]),
  ReferenceType: (printer, node) => ['&', printer.print(node.referent)],
  UnionType: (printer, node) =>
    join(
      ' | ',
      node.members.map((member) => printer.print(member)),
    ),
  LiteralType: (printer, node) => printer.print(node.value),
  MemberType: (printer, node) => [printer.print(node.owner), '.', printer.print(node.name)],
  IndexedType: (printer, node) => [
    printer.print(node.owner),
    enclosed(printer, node, ['[', ']'], node.key),
  ],
  KeyofType: (printer, node) => ['keyof ', printer.print(node.owner)],
  InferType: (printer, node) => ['infer ', printer.print(node.parameter)],
  TypeMatch: (printer, node) => [
    'match ',
    printer.print(node.subject),
    ':',
    indentedBody(printer, undefined, node.cases),
  ],
  TypeCase: (printer, node) =>
    group(['case ', printer.print(node.pattern), ':', indent([line, printer.print(node.type)])]),
  MappedField: (printer, node) =>
    annotated(printer, node, [
      enclosed(printer, node, ['[', ']'], node.parameter),
      ': ',
      printer.print(node.type),
    ]),
  StructConstraint: (printer, node) => {
    const entries = fieldList(printer, node, node.entries);
    return entries === '{}' ? 'struct' : ['struct ', entries];
  },
  OtherFields: () => '[_]',
  FieldTypeEntry: (printer, node) => [printer.print(node.field), ': ', printer.print(node.type)],
  FieldConstraintEntry: (printer, node) => [
    printer.print(node.field),
    constraintsAfterIs(printer, node.constraints),
  ],
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** ` is A & B`, the constraints after `is` (§3.5); nothing for none. */
export function constraintsAfterIs(
  printer: Printer,
  constraints: readonly ConstraintNode[],
): builders.Doc {
  return constraints.length === 0
    ? ''
    : [
        ' is ',
        join(
          ' & ',
          constraints.map((constraint) => printer.print(constraint)),
        ),
      ];
}
