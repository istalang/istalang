/**
 * The whole node vocabulary, and traversal derived from it.
 *
 * Children are found by reading a node's fields, not from a per-kind list. A field holds a node, an
 * array of nodes, an optional node or node array, or a primitive (node.ts), so any object with a
 * `kind` is a child. Adding a node kind therefore needs no traversal change. Children come back in
 * source order, derived from their spans, so no builder has to put fields in any order.
 *
 * What tools ask of a tree by position derives from the same children, memoized on the immutable
 * node or tree: a node's parent, and the nodes at an offset. A child's span lies inside its
 * parent's and before its next sibling's (the parser's tests hold every tree to it), so the nodes
 * at an offset are found by descending from the root.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import { memo } from '../../structures/memo.ts';
import type { SourceText } from '../../text/source-text.ts';
import type { Annotation } from './annotations.ts';
import type { Declaration, DeclarationPart, FunctionDeclaration, Module } from './declarations.ts';
import type { Expression, ExpressionPart, Lambda } from './expressions/index.ts';
import type { Identifier, Invalid, Missing } from './node.ts';
import type { Pattern, PatternPart } from './patterns.ts';
import type { Block, Statement, StatementPart } from './statements.ts';
import type { Comment } from './tokens.ts';
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
  | PatternPart
  | Statement
  | StatementPart
  | Block
  | Declaration
  | DeclarationPart
  | Module
  | Annotation;

/**
 * What parsing one source file yields: its module, its comments, and the diagnostics of scanning
 * and parsing it, in that order. Later phases need nothing else from the syntax of a file.
 */
export interface SyntaxTree {
  readonly source: SourceText;
  readonly root: Module;
  readonly comments: readonly Comment[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Whether a field value is a node, as opposed to a primitive, a span or undefined. */
export function isNode(value: unknown): value is SyntaxNode {
  return typeof value === 'object' && value !== null && 'kind' in value;
}

const children = new WeakMap<SyntaxNode, readonly SyntaxNode[]>();

/** A node's direct children, in source order. */
export function childrenOf(node: SyntaxNode): readonly SyntaxNode[] {
  return memo(children, node, () =>
    Object.values(node)
      .flatMap((value: unknown) => (Array.isArray(value) ? value : [value]).filter(isNode))
      .toSorted((first, second) => first.span.start - second.span.start),
  );
}

const parents = new WeakMap<SyntaxTree, ReadonlyMap<SyntaxNode, SyntaxNode>>();

/** The node `node` is a child of in `tree`; undefined for the root, or a node `tree` lacks. */
export function parentOf(tree: SyntaxTree, node: SyntaxNode): SyntaxNode | undefined {
  return memo(parents, tree, () => parentsUnder(tree.root)).get(node);
}

function parentsUnder(root: SyntaxNode): ReadonlyMap<SyntaxNode, SyntaxNode> {
  return new Map(
    nodesUnder(root).flatMap((parent) =>
      childrenOf(parent).map((child) => [child, parent] as const),
    ),
  );
}

/**
 * `node` and every node under it, in source order, each before its children. Trees nest as deep as
 * the parser allows, so the walk keeps its own stack.
 */
export function nodesUnder(node: SyntaxNode): readonly SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  const pending = [node];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    nodes.push(next);
    pending.push(...childrenOf(next).toReversed());
  }
  return nodes;
}

/**
 * The nodes of `tree` holding `offset`, from the root to the innermost. A span holds the offsets
 * from its start up to its end, not including it: of two nodes that touch, only the second holds
 * the offset where they meet, and an empty node, such as a `Missing`, holds none.
 */
export function nodesAt(tree: SyntaxTree, offset: number): readonly SyntaxNode[] {
  const holds = (node: SyntaxNode) => node.span.start <= offset && offset < node.span.end;
  const path: SyntaxNode[] = [];
  for (
    let node: SyntaxNode | undefined = holds(tree.root) ? tree.root : undefined;
    node !== undefined;
    node = childrenOf(node).find(holds)
  ) {
    path.push(node);
  }
  return path;
}

/** Whether `node` makes a function of its own, a lambda or a local function (§3.14). */
export function nestsFunction(node: SyntaxNode): node is Lambda | FunctionDeclaration {
  return node.kind === 'Lambda' || node.kind === 'FunctionDeclaration';
}

/**
 * The children of `node` that run where it stands, as part of the function holding it: none for a
 * lambda or local function, whose body runs when it is called. Walking a body by these alone
 * never enters a function it nests.
 */
export function bodyChildrenOf(node: SyntaxNode): readonly SyntaxNode[] {
  return nestsFunction(node) ? [] : childrenOf(node);
}
