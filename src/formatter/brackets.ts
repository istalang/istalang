/**
 * Which nodes stand in brackets, where a line break means nothing (spec §2): inside `()`, `[]` and
 * a struct literal's or pattern's `{}`. A block nested there, or a field list, makes line breaks
 * count again (parser/cursor.ts), and so does a template's `${…}` for the formatter, which keeps
 * a single-line template on its line.
 *
 * Derived once per tree, from the tree alone, so a printer asks instead of being told by its
 * caller.
 */

import { childrenOf, type SyntaxNode, type SyntaxTree } from '../compiler/syntax/tree.ts';

/** Whether `child` of `parent` stands in brackets, given whether `parent` does. */
function inBracketsUnder(
  parent: SyntaxNode,
  child: SyntaxNode,
  parentInBrackets: boolean,
): boolean {
  switch (parent.kind) {
    case 'Block':
    case 'StructType':
    case 'Variant':
    case 'TemplateLiteral':
      return false;
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
      return true;
    case 'StructLiteral':
    case 'NewStructLiteral':
    case 'StructPattern':
      return child !== parent.type || parentInBrackets;
    case 'Call':
      return child !== parent.callee || parentInBrackets;
    case 'Index':
      return child === parent.index || parentInBrackets;
    case 'Lambda':
    case 'FunctionDeclaration':
    case 'FunctionType': {
      const parameters: readonly SyntaxNode[] = parent.parameters;
      return parameters.includes(child) || parentInBrackets;
    }
    default:
      return parentInBrackets;
  }
}

/** Every node of `tree` that stands in brackets. */
export function nodesInBrackets(tree: SyntaxTree): ReadonlySet<SyntaxNode> {
  const found = new Set<SyntaxNode>();
  const visit = (node: SyntaxNode, inBrackets: boolean): void => {
    if (inBrackets) {
      found.add(node);
    }
    for (const child of childrenOf(tree, node)) {
      visit(child, inBracketsUnder(node, child, inBrackets));
    }
  };
  visit(tree.root, false);
  return found;
}
