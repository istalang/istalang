/**
 * Observations on syntax trees, shared by every phase's tests.
 *
 * `dump` prints a tree as a compact S-expression derived from node fields, so a test states a
 * whole tree in one readable line and no printer needs updating when a node kind is added:
 * - a name prints as its text, and a literal as its value
 * - another node prints as `(Kind field…)`
 * - a true flag prints as its field name, and a false one is omitted
 * - an absent optional prints `_`; Missing prints `?` and Invalid `!`
 */

import type { SourceText } from '../../text/source-text.ts';
import { textOf } from '../../text/span.ts';
import { childrenOf, isNode, type SyntaxNode } from './tree.ts';

function dumpField(name: string, value: unknown): string | undefined {
  if (value === undefined) {
    return '_';
  }
  if (typeof value === 'boolean') {
    return value ? name : undefined;
  }
  if (Array.isArray(value)) {
    return `[${value.map(dumpValue).join(' ')}]`;
  }
  return dumpValue(value);
}

function dumpValue(value: unknown): string {
  return isNode(value) ? dump(value) : String(value);
}

function dumpLeaf(node: SyntaxNode): string | undefined {
  switch (node.kind) {
    case 'Identifier':
      return node.text === '' ? '<missing name>' : node.text;
    case 'IntegerLiteral':
    case 'FloatLiteral':
    case 'BooleanLiteral':
      return String(node.value);
    case 'DurationLiteral':
      return `${node.value}ms`;
    case 'StringLiteral':
      return JSON.stringify(node.value);
    case 'NoneLiteral':
      return 'none';
    case 'Missing':
      return '?';
    case 'Invalid':
      return '!';
    default:
      return undefined;
  }
}

/** A tree as a one-line S-expression. */
export function dump(node: SyntaxNode): string {
  const leaf = dumpLeaf(node);
  if (leaf !== undefined) {
    return leaf;
  }
  const fields = Object.entries(node)
    .filter(([name]) => name !== 'kind' && name !== 'span')
    .map(([name, value]) => dumpField(name, value))
    .filter((field) => field !== undefined);
  return `(${[node.kind, ...fields].join(' ')})`;
}

/** Every node of a tree, the root first. */
export function descendants(node: SyntaxNode): readonly SyntaxNode[] {
  return [node, ...childrenOf(node).flatMap(descendants)];
}

/** Where children stick out of their parent or overlap their siblings. Empty when well nested. */
export function spanViolations(root: SyntaxNode): readonly string[] {
  return descendants(root).flatMap((parent) => {
    const children = childrenOf(parent);
    return children.flatMap((child, index) => {
      const previous = children[index - 1];
      const label = `${child.kind} in ${parent.kind}`;
      return [
        ...(child.span.start < parent.span.start || child.span.end > parent.span.end
          ? [`${label} lies outside its parent`]
          : []),
        ...(previous !== undefined && previous.span.end > child.span.start
          ? [`${label} overlaps ${previous.kind}`]
          : []),
        ...(child.span.end < child.span.start ? [`${label} has a negative span`] : []),
      ];
    });
  });
}

/** Nodes that stand for an error: Missing, Invalid, and names the parser didn't find. */
export function errorNodes(root: SyntaxNode): readonly SyntaxNode[] {
  return descendants(root).filter(
    (node) =>
      node.kind === 'Missing' ||
      node.kind === 'Invalid' ||
      (node.kind === 'Identifier' && node.text === ''),
  );
}

/** The source text a node covers. */
export function nodeText(source: SourceText, node: SyntaxNode): string {
  return textOf(source, node.span);
}
