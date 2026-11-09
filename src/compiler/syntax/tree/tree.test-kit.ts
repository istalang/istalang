import { encloses } from '../../../foundation/text/span.ts';
import type { FunctionQualifiers } from '../tokens/modifiers.ts';
import {
  bodyOf,
  childrenOf,
  extentIn,
  isNode,
  nodesUnder,
  type SyntaxNode,
  type SyntaxTree,
  type TreeBodies,
  type TreePlaces,
} from './index.ts';
import type { AnchoredSpan, Segment, SegmentBases } from './positions.ts';

/** The segment of the nodes and spans a test makes by hand, which starts its text. */
const handMade: Segment = { kind: 'module' };

/** Where `handMadeSpan`'s segment starts, as a tree would give it. */
export const handMadeBases: SegmentBases = { bases: new Map([[handMade, 0]]) };

/** A span a test makes by hand, from `from` to `to` of its text. */
export function handMadeSpan(from: number, to = from): AnchoredSpan {
  return { segment: handMade, from, to };
}

function dumpField(tree: TreeBodies, name: string, value: unknown): string | undefined {
  if (value === undefined) {
    return '_';
  }
  if (typeof value === 'boolean') {
    return value ? name : undefined;
  }
  if (Array.isArray(value)) {
    return `[${value.map((each) => dumpValue(tree, each)).join(' ')}]`;
  }
  if (name === 'qualifiers') {
    return wordsOf(value as FunctionQualifiers);
  }
  return dumpValue(tree, value);
}

/** A function's qualifiers: the words they hold, or nothing when they hold none. */
function wordsOf(qualifiers: FunctionQualifiers): string | undefined {
  const words = Object.values(qualifiers).filter((word) => word !== undefined);
  return words.length === 0 ? undefined : words.join(' ');
}

function dumpValue(tree: TreeBodies, value: unknown): string {
  return isNode(value) ? dump(tree, value) : String(value);
}

/** A node's fields by name, a function's body among them, after its return type. */
function fieldsOf(tree: TreeBodies, node: SyntaxNode): readonly (readonly [string, unknown])[] {
  const fields = Object.entries(node);
  if (node.kind !== 'FunctionDeclaration') {
    return fields;
  }
  const afterReturnType = fields.findIndex(([name]) => name === 'returnType') + 1;
  return fields.toSpliced(afterReturnType, 0, ['body', bodyOf(tree, node)]);
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

/** `node` of `tree`, and everything under it, as a one-line S-expression. */
export function dump(tree: TreeBodies, node: SyntaxNode): string {
  const leaf = dumpLeaf(node);
  if (leaf !== undefined) {
    return leaf;
  }
  const fields = fieldsOf(tree, node)
    .filter(([name]) => name !== 'kind' && name !== 'span')
    .map(([name, value]) => dumpField(tree, name, value))
    .filter((field) => field !== undefined);
  return `(${[node.kind, ...fields].join(' ')})`;
}

/**
 * Where the text a child covers sticks out of its parent's or overlaps its siblings', or a span
 * ends before it starts. Empty when well nested.
 */
export function spanViolations(tree: TreePlaces, root: SyntaxNode): readonly string[] {
  return nodesUnder(tree, root).flatMap((parent) => {
    const children = childrenOf(tree, parent);
    const outer = extentIn(tree, parent);
    return children.flatMap((child, index) => {
      const previous = children[index - 1];
      const extent = extentIn(tree, child);
      const label = `${child.kind} in ${parent.kind}`;
      return [
        ...(encloses(outer, extent) ? [] : [`${label} lies outside its parent`]),
        ...(previous !== undefined && extentIn(tree, previous).end > extent.start
          ? [`${label} overlaps ${previous.kind}`]
          : []),
        ...(child.span.to < child.span.from ? [`${label} has a negative span`] : []),
        ...(child.span.from < 0 ? [`${label} starts before its segment`] : []),
      ];
    });
  });
}

/** The bodies `tree` holds of functions it doesn't, as a node the parser let go of would leave. */
export function strayBodies(tree: SyntaxTree): readonly string[] {
  const functions = new Set(nodesUnder(tree, tree.root));
  return [...tree.bodies.keys()]
    .filter((declaration) => !functions.has(declaration))
    .map(({ span }) => `the body of a function at ${span.from}`);
}

/** Nodes that stand for an error: Missing, Invalid, and names the parser didn't find. */
export function errorNodes(tree: TreeBodies, root: SyntaxNode): readonly SyntaxNode[] {
  return nodesUnder(tree, root).filter(
    (node) =>
      node.kind === 'Missing' ||
      node.kind === 'Invalid' ||
      (node.kind === 'Identifier' && node.text === ''),
  );
}
