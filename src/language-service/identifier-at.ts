/**
 * The name an editor's cursor is on. A cursor stands between characters, so it is on a name when
 * inside it or right after its last character, as after typing it; inside one name and right after
 * another can't both hold, since two names never touch.
 */

import { type Identifier, isMissingName } from '../compiler/syntax/node.ts';
import { nodesAt, type SyntaxTree } from '../compiler/syntax/tree.ts';

/** The identifier of `tree` whose span holds `offset`, or ends at it; undefined for none. */
export function identifierAt(tree: SyntaxTree, offset: number): Identifier | undefined {
  return innermostIdentifier(tree, offset) ?? innermostIdentifier(tree, offset - 1);
}

function innermostIdentifier(tree: SyntaxTree, offset: number): Identifier | undefined {
  const innermost = nodesAt(tree, offset).at(-1);
  return innermost?.kind === 'Identifier' && !isMissingName(innermost) ? innermost : undefined;
}
