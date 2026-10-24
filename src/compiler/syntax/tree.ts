/**
 * The whole node vocabulary, and traversal derived from it.
 *
 * Children are found by reading a node's fields, not from a per-kind list. A field holds a node, an
 * array of nodes, an optional node, or a primitive (node.ts), so any object with a `kind` is a
 * child. Adding a node kind therefore needs no traversal change. The parser builds every node with
 * its fields in source order, so children come back in source order.
 */

import type { Expression, ExpressionPart } from './expressions.ts';
import type { Identifier, Invalid, Missing } from './node.ts';
import type { Pattern, PatternPart } from './patterns.ts';
import type { TypeNode, TypePart } from './types.ts';

export type SyntaxNode =
  | Identifier
  | Missing
  | Invalid
  | Expression
  | ExpressionPart
  | TypeNode
  | TypePart
  | Pattern
  | PatternPart;

export type SyntaxKind = SyntaxNode['kind'];

/** Whether a field value is a node, as opposed to a primitive, a span or undefined. */
export function isNode(value: unknown): value is SyntaxNode {
  return typeof value === 'object' && value !== null && 'kind' in value;
}

/** A node's direct children, in source order. */
export function childrenOf(node: SyntaxNode): readonly SyntaxNode[] {
  return Object.values(node).flatMap((value: unknown) =>
    Array.isArray(value) ? value.filter(isNode) : [value].filter(isNode),
  );
}
