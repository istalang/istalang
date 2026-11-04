/**
 * Random type trees for the type precedence property: unions, literal types, optionals, function
 * types and type arguments, the text writing each with only the parentheses the grammar needs, and
 * the tree a parsed type denotes, parentheses ignored.
 *
 * `|` binds looser than `?` and type arguments and tighter than `->` (§2), so the printer wraps a
 * union, or a function type, under `?`, and a function type in a union unless it is the last
 * member, whose return type would take the members after it. A union member that is itself a union
 * is wrapped too, as the tree keeps members as written.
 */

import fc from 'fast-check';
import type { TypeNode } from '../syntax/types.ts';

export type TypeTree =
  | { readonly atom: string }
  | { readonly union: readonly TypeTree[] }
  | { readonly optional: TypeTree }
  | { readonly returns: TypeTree }
  | { readonly argument: TypeTree };

const atoms = ['Int', 'A', 'm.B', '"draft"', '42', '-1', 'true', 'false'];

export const typeTree: fc.Arbitrary<TypeTree> = fc.letrec<{ tree: TypeTree }>((tie) => ({
  tree: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constantFrom(...atoms).map((atom) => ({ atom })),
    fc.array(tie('tree'), { minLength: 2, maxLength: 3 }).map((union) => ({ union })),
    tie('tree').map((optional) => ({ optional })),
    tie('tree').map((returns) => ({ returns })),
    tie('tree').map((argument) => ({ argument })),
  ),
})).tree;

function grouped(text: string, needsGroup: boolean): string {
  return needsGroup ? `(${text})` : text;
}

/** The text writing `tree` with only the parentheses its grammar needs. */
export function printType(tree: TypeTree): string {
  if ('atom' in tree) {
    return tree.atom;
  }
  if ('union' in tree) {
    const last = tree.union.length - 1;
    return tree.union
      .map((member, index) =>
        grouped(printType(member), 'union' in member || ('returns' in member && index < last)),
      )
      .join(' | ');
  }
  if ('optional' in tree) {
    const { optional } = tree;
    return `${grouped(printType(optional), 'union' in optional || 'returns' in optional)}?`;
  }
  if ('returns' in tree) {
    return `fn() -> ${printType(tree.returns)}`;
  }
  return `Array<${printType(tree.argument)}>`;
}

/** The tree `node` denotes, parentheses ignored; other nodes show their kind. */
export function typeShapeOf(node: TypeNode): TypeTree | { readonly unexpected: string } {
  switch (node.kind) {
    case 'ParenthesizedType':
      return typeShapeOf(node.inner);
    case 'NamedType': {
      const [argument] = node.typeArguments;
      return argument === undefined
        ? { atom: node.path.map(({ text }) => text).join('.') }
        : { argument: typeShapeOf(argument) as TypeTree };
    }
    case 'LiteralType':
      return { atom: literalText(node.value) };
    case 'UnionType':
      return { union: node.members.map((member) => typeShapeOf(member) as TypeTree) };
    case 'OptionalType':
      return { optional: typeShapeOf(node.inner) as TypeTree };
    case 'FunctionType':
      return node.returnType === undefined
        ? { unexpected: 'unit FunctionType' }
        : { returns: typeShapeOf(node.returnType) as TypeTree };
    default:
      return { unexpected: node.kind };
  }
}

function literalText(value: Extract<TypeNode, { kind: 'LiteralType' }>['value']): string {
  switch (value.kind) {
    case 'StringLiteral':
      return JSON.stringify(value.value);
    case 'IntegerLiteral':
    case 'BooleanLiteral':
      return String(value.value);
    case 'Unary':
      return value.operand.kind === 'IntegerLiteral' ? `-${value.operand.value}` : 'unexpected';
    default:
      return value.kind;
  }
}
