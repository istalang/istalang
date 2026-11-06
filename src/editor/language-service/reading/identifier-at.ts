/**
 * The name an editor's cursor is on, or the String literal, which may name a field as a key. A
 * cursor stands between characters, so it is on a name when inside it or right after its last
 * character, as after typing it; inside one name and right after another can't both hold, since
 * two names never touch.
 */

import type { StringLiteral } from '../../../compiler/syntax/expressions/literals/literals.ts';
import { nodesAt, type SyntaxTree } from '../../../compiler/syntax/tree/index.ts';
import { type Identifier, isMissingName } from '../../../compiler/syntax/tree/node.ts';

/** The identifier of `tree` whose span holds `offset`, or ends at it; undefined for none. */
export function identifierAt(tree: SyntaxTree, offset: number): Identifier | undefined {
  return innermostIdentifier(tree, offset) ?? innermostIdentifier(tree, offset - 1);
}

function innermostIdentifier(tree: SyntaxTree, offset: number): Identifier | undefined {
  const innermost = nodesAt(tree, offset).at(-1);
  return innermost?.kind === 'Identifier' && !isMissingName(innermost) ? innermost : undefined;
}

/**
 * The String literal of `tree` the cursor at `offset` is on, as `identifierAt` places it: what
 * may be a key naming a field (§3.1 Key types); undefined for none.
 */
export function stringLiteralAt(tree: SyntaxTree, offset: number): StringLiteral | undefined {
  return innermostLiteral(tree, offset) ?? innermostLiteral(tree, offset - 1);
}

function innermostLiteral(tree: SyntaxTree, offset: number): StringLiteral | undefined {
  const innermost = nodesAt(tree, offset).at(-1);
  return innermost?.kind === 'StringLiteral' ? innermost : undefined;
}
