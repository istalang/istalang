import {
  bodyOf,
  childrenOf,
  isNode,
  nodesUnder,
  type SyntaxNode,
  type SyntaxTree,
  type TreeBodies,
} from './tree.ts';

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
  return dumpValue(tree, value);
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

/** Where children stick out of their parent or overlap their siblings. Empty when well nested. */
export function spanViolations(tree: TreeBodies, root: SyntaxNode): readonly string[] {
  return nodesUnder(tree, root).flatMap((parent) => {
    const children = childrenOf(tree, parent);
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

/** The bodies `tree` holds of functions it doesn't, as a node the parser let go of would leave. */
export function strayBodies(tree: SyntaxTree): readonly string[] {
  const functions = new Set(nodesUnder(tree, tree.root));
  return [...tree.bodies.keys()]
    .filter((declaration) => !functions.has(declaration))
    .map(({ span }) => `the body of a function at ${span.start}`);
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
