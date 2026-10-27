/**
 * The whole node vocabulary, and traversal derived from it.
 *
 * Children are found by reading a node's fields, not from a per-kind list. A field holds a node, an
 * array of nodes, an optional node or node array, or a primitive (node.ts), so any object with a
 * `kind` is a child. Adding a node kind therefore needs no traversal change. Children come back in
 * source order, derived from their spans, so no builder has to put fields in any order.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
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

/** A node's direct children, in source order. */
export function childrenOf(node: SyntaxNode): readonly SyntaxNode[] {
  return Object.values(node)
    .flatMap((value: unknown) => (Array.isArray(value) ? value : [value]).filter(isNode))
    .toSorted((first, second) => first.span.start - second.span.start);
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
