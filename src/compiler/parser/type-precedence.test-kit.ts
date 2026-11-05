/**
 * Random type trees for the type precedence property: unions, literal types, optionals, function
 * types, type arguments, `keyof` and a field's type by key (`S[K]`), the text writing each with
 * only the parentheses the grammar needs, and the tree a parsed type denotes, parentheses ignored.
 *
 * `|` binds looser than `?`, `[K]` and type arguments and tighter than `->` (§2), and `keyof`
 * binds between them (§3.1), so the printer wraps a union, a function type or a `keyof` under `?`
 * or before `[K]`, a union or a function type after `keyof`, and a function type in a union unless
 * it is the last member, whose return type would take the members after it. A union member that is
 * itself a union is wrapped too, as the tree keeps members as written.
 */

import fc from 'fast-check';
import type { TypeNode } from '../syntax/types.ts';

export type TypeTree =
  | { readonly atom: string }
  | { readonly union: readonly TypeTree[] }
  | { readonly optional: TypeTree }
  | { readonly returns: TypeTree }
  | { readonly argument: TypeTree }
  | { readonly keys: TypeTree }
  | { readonly indexed: TypeTree; readonly key: TypeTree };

const atoms = ['Int', 'A', 'm.B', '"draft"', '42', '-1', 'true', 'false'];

export const typeTree: fc.Arbitrary<TypeTree> = fc.letrec<{ tree: TypeTree }>((tie) => ({
  tree: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constantFrom(...atoms).map((atom) => ({ atom })),
    fc.array(tie('tree'), { minLength: 2, maxLength: 3 }).map((union) => ({ union })),
    tie('tree').map((optional) => ({ optional })),
    tie('tree').map((returns) => ({ returns })),
    tie('tree').map((argument) => ({ argument })),
    tie('tree').map((keys) => ({ keys })),
    fc.tuple(tie('tree'), tie('tree')).map(([indexed, key]) => ({ indexed, key })),
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
    return `${grouped(printType(tree.optional), bindsLooserThanPostfix(tree.optional))}?`;
  }
  if ('returns' in tree) {
    return `fn() -> ${printType(tree.returns)}`;
  }
  if ('keys' in tree) {
    const { keys } = tree;
    return `keyof ${grouped(printType(keys), 'union' in keys || 'returns' in keys)}`;
  }
  if ('indexed' in tree) {
    const owner = grouped(printType(tree.indexed), bindsLooserThanPostfix(tree.indexed));
    return `${owner}[${printType(tree.key)}]`;
  }
  return `Array<${printType(tree.argument)}>`;
}

/** Whether `tree` needs parentheses before a postfix `?` or `[K]`. */
function bindsLooserThanPostfix(tree: TypeTree): boolean {
  return 'union' in tree || 'returns' in tree || 'keys' in tree;
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
    case 'KeyofType':
      return { keys: typeShapeOf(node.owner) as TypeTree };
    case 'IndexedType':
      return {
        indexed: typeShapeOf(node.owner) as TypeTree,
        key: typeShapeOf(node.key) as TypeTree,
      };
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
