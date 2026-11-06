/**
 * The whole node vocabulary, and traversal derived from it.
 *
 * Children are found by reading a node's fields, not from a per-kind list. A field holds a node, an
 * array of nodes, an optional node or node array, or a primitive (node.ts), so any object with a
 * `kind` is a child. Adding a node kind therefore needs no traversal change. Children come back in
 * source order, derived from their spans, so no builder has to put fields in any order. Spans
 * compare only within a segment (positions.ts), so children heading segments of their own, a
 * module's items and a trait's members, come after the rest, in the order their field lists them.
 *
 * A function's body is the one child not in a field: the tree holds it, so a declaration's node can
 * outlive an edit of its body (docs/work/m6-m7/incremental-checking.md). Traversal therefore takes
 * the tree, and a function's children are its fields' and then its body. A walk that reaches bodies
 * its own way, as checking does through the reads it records, takes a node's field children alone.
 *
 * What tools ask of a tree by position derives from the same children, memoized on the immutable
 * node or tree: a node's parent, the text a node and everything under it cover (its extent, as its
 * own span is anchored to its segment: positions.ts), and the nodes at an offset. A child's extent
 * lies inside its parent's and before its next sibling's (the parser's tests hold every tree to
 * it), so the nodes at an offset are found by descending from the root.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import { memo, SequenceMemo } from '../../structures/memo.ts';
import type { SourceText } from '../../text/source-text.ts';
import type { Span } from '../../text/span.ts';
import type { Annotation } from './annotations.ts';
import type {
  Declaration,
  DeclarationPart,
  FunctionDeclaration,
  Module,
} from './declarations/index.ts';
import type { Expression, ExpressionPart, Lambda } from './expressions/index.ts';
import type { Identifier, Invalid, Missing } from './node.ts';
import type { Pattern, PatternPart } from './patterns.ts';
import { type SegmentBases, spanIn } from './positions.ts';
import type { Block, Statement, StatementPart } from './statements.ts';
import type { Comment } from './tokens.ts';
import type { TypeNode, TypePart } from './types/index.ts';

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
 * What parsing one source file yields: its module, the body of each function that has one, where
 * each segment of its text starts (positions.ts), its comments, and the diagnostics of scanning and
 * parsing it, in that order. Later phases need nothing else from the syntax of a file. Bodies are
 * read through `bodyOf`, and text positions through `spanIn`.
 */
export interface SyntaxTree extends SegmentBases {
  readonly source: SourceText;
  readonly root: Module;
  readonly bodies: ReadonlyMap<FunctionDeclaration, Block>;
  readonly comments: readonly Comment[];
  readonly diagnostics: readonly Diagnostic[];
}

/** What a walk reads of a tree beyond its nodes: the body of each function. */
export type TreeBodies = Pick<SyntaxTree, 'bodies'>;

/** What placing a node in the text reads of its tree: the bodies under it and the segments. */
export type TreePlaces = Pick<SyntaxTree, 'bodies' | 'bases'>;

/** The body of `declaration`, a function of `tree`; undefined for one written without a body. */
export function bodyOf(tree: TreeBodies, declaration: FunctionDeclaration): Block | undefined {
  return tree.bodies.get(declaration);
}

/** Whether a field value is a node, as opposed to a primitive, a span or undefined. */
export function isNode(value: unknown): value is SyntaxNode {
  return typeof value === 'object' && value !== null && 'kind' in value;
}

const fieldChildren = new WeakMap<SyntaxNode, readonly SyntaxNode[]>();

/** A node's direct children in `tree`, in source order. */
export function childrenOf(tree: TreeBodies, node: SyntaxNode): readonly SyntaxNode[] {
  const inFields = fieldChildrenOf(node);
  const body = node.kind === 'FunctionDeclaration' ? bodyOf(tree, node) : undefined;
  return body === undefined ? inFields : [...inFields, body];
}

/**
 * The children `node`'s fields hold, in source order: all of them, but for a function's body.
 * An immutable node holds them for good.
 */
export function fieldChildrenOf(node: SyntaxNode): readonly SyntaxNode[] {
  return memo(fieldChildren, node, () => {
    const children = Object.values(node).flatMap((value: unknown) =>
      (Array.isArray(value) ? value : [value]).filter(isNode),
    );
    const inSegment = (child: SyntaxNode) => child.span.segment === node.span.segment;
    return [
      ...children.filter(inSegment).toSorted((first, second) => first.span.from - second.span.from),
      ...children.filter((child) => !inSegment(child)),
    ];
  });
}

const parents = new WeakMap<SyntaxTree, ReadonlyMap<SyntaxNode, SyntaxNode>>();

/** The node `node` is a child of in `tree`; undefined for the root, or a node `tree` lacks. */
export function parentOf(tree: SyntaxTree, node: SyntaxNode): SyntaxNode | undefined {
  return memo(parents, tree, () => parentsIn(tree)).get(node);
}

function parentsIn(tree: SyntaxTree): ReadonlyMap<SyntaxNode, SyntaxNode> {
  return new Map(
    nodesUnder(tree, tree.root).flatMap((parent) =>
      childrenOf(tree, parent).map((child) => [child, parent] as const),
    ),
  );
}

/**
 * `node` and every node under it in `tree`, in source order, each before its children. Trees nest
 * as deep as the parser allows, so the walk keeps its own stack.
 */
export function nodesUnder(tree: TreeBodies, node: SyntaxNode): readonly SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  const pending = [node];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    nodes.push(next);
    pending.push(...childrenOf(tree, next).toReversed());
  }
  return nodes;
}

/**
 * The nodes of `tree` holding `offset`, from the root to the innermost. A node holds the offsets
 * its extent covers, from its start up to its end, not including it: of two nodes that touch, only
 * the second holds the offset where they meet, and an empty node, such as a `Missing`, holds none.
 */
export function nodesAt(tree: SyntaxTree, offset: number): readonly SyntaxNode[] {
  const holds = (node: SyntaxNode) => {
    const { start, end } = extentIn(tree, node);
    return start <= offset && offset < end;
  };
  const path: SyntaxNode[] = [];
  for (
    let node: SyntaxNode | undefined = holds(tree.root) ? tree.root : undefined;
    node !== undefined;
    node = childrenOf(tree, node).find(holds)
  ) {
    path.push(node);
  }
  return path;
}

/** Each node's extent in each tree that holds it: a node reused across edits sits at other offsets. */
const extents = new SequenceMemo<TreePlaces | SyntaxNode, Span>();

/**
 * The text `node` and every node under it cover in `tree`'s text, through its body, members and
 * items, which its own span may leave out. Children come in source order, so the first and last
 * child decide it, level by level down to the leaves.
 */
export function extentIn(tree: TreePlaces, node: SyntaxNode): Span {
  return extents.get([tree, node], () => {
    let { start, end } = spanIn(tree, node.span);
    for (
      let [first] = childrenOf(tree, node);
      first !== undefined;
      [first] = childrenOf(tree, first)
    ) {
      start = Math.min(start, spanIn(tree, first.span).start);
    }
    for (let last = lastChildOf(tree, node); last !== undefined; last = lastChildOf(tree, last)) {
      end = Math.max(end, spanIn(tree, last.span).end);
    }
    return { start, end };
  });
}

function lastChildOf(tree: TreeBodies, node: SyntaxNode): SyntaxNode | undefined {
  return childrenOf(tree, node).at(-1);
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
  return nestsFunction(node) ? [] : fieldChildrenOf(node);
}
