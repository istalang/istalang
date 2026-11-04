/**
 * Types (spec §2, §3). An anonymous struct type prints as its braces alone: in a type position
 * `struct` before `{` changes nothing (§3.1), and the indented field block under a field is sugar
 * for the same type, so braces are the one spelling.
 */

import { builders } from 'prettier/doc';
import type { TypeNode, TypePart } from '../compiler/syntax/types.ts';
import { annotated } from './bodies.ts';
import { angled, bracketed, enclosed, fieldList, tupleList } from './lists.ts';
import type { Printers } from './printer.ts';

const { join } = builders;

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
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.
