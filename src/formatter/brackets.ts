/**
 * Which nodes stand in brackets, where a line break means nothing (spec §2): inside `()`, `[]` and
 * a struct literal's or pattern's `{}`. A block nested there, or a field list, makes line breaks
 * count again (parser/cursor.ts), and so does a template's `${…}` for the formatter, which keeps
 * a single-line template on its line.
 *
 * Derived once per tree, from the tree alone, so a printer asks instead of being told by its
 * caller. Which delimiters enclose which children is listed once (`standingIn`), which bodies.ts
 * also reads: an `else` can't continue a body standing inside any of them.
 */

import { childrenOf, type SyntaxNode, type SyntaxTree } from '../compiler/syntax/tree.ts';

/**
 * Where a child stands in its parent, the one list of which delimiters enclose which children:
 * - `outside` its parent's delimiters, standing as its parent does: a call's callee, an index's
 *   target, a struct literal's or pattern's type, a function's result and body, any child of a
 *   node with no delimiters;
 * - in `brackets`, `()`, `[]` or a struct literal's or pattern's `{}`, where a line break means
 *   nothing;
 * - in `braces` that hold lines again: a braced block's `{}`, a field list's, a template's `${…}`;
 * - on a block's `lines`, with no delimiters around them, where line breaks count again.
 */
export type Standing = 'outside' | 'brackets' | 'braces' | 'lines';

/** Where `child` of `parent` stands (`Standing`). */
export function standingIn(parent: SyntaxNode, child: SyntaxNode): Standing {
  switch (parent.kind) {
    case 'Block':
      return 'lines';
    case 'BlockExpression':
    case 'StructType':
    case 'StructConstraint':
    case 'Variant':
    case 'TemplateLiteral':
      return 'braces';
    case 'ArrayLiteral':
    case 'MapLiteral':
    case 'Comprehension':
    case 'Tuple':
    case 'Parenthesized':
    case 'TuplePattern':
    case 'ParenthesizedPattern':
    case 'ArrayPattern':
    case 'TupleType':
    case 'ParenthesizedType':
      return 'brackets';
    case 'StructLiteral':
    case 'NewStructLiteral':
    case 'StructPattern':
      return child === parent.type ? 'outside' : 'brackets';
    case 'Call':
      return child === parent.callee ? 'outside' : 'brackets';
    case 'Index':
      return child === parent.index ? 'brackets' : 'outside';
    case 'IndexedType':
      return child === parent.key ? 'brackets' : 'outside';
    case 'MappedField':
      return child === parent.parameter ? 'brackets' : 'outside';
    case 'Lambda':
    case 'FunctionDeclaration':
    case 'FunctionType': {
      const parameters: readonly SyntaxNode[] = parent.parameters;
      return parameters.includes(child) ? 'brackets' : 'outside';
    }
    default:
      return 'outside';
  }
}

/** Whether a child standing so stands in brackets, given whether its parent does. */
const inBracketsAs: Readonly<Record<Standing, (parentInBrackets: boolean) => boolean>> = {
  outside: (parentInBrackets) => parentInBrackets,
  brackets: () => true,
  braces: () => false,
  lines: () => false,
};

/** Every node of `tree` that stands in brackets. */
export function nodesInBrackets(tree: SyntaxTree): ReadonlySet<SyntaxNode> {
  const found = new Set<SyntaxNode>();
  const visit = (node: SyntaxNode, inBrackets: boolean): void => {
    if (inBrackets) {
      found.add(node);
    }
    for (const child of childrenOf(tree, node)) {
      visit(child, inBracketsAs[standingIn(node, child)](inBrackets));
    }
  };
  visit(tree.root, false);
  return found;
}
