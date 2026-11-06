/**
 * What encloses a position, read from the nodes holding the placeholder: the body it runs in and
 * the scopes a label may name around it. Both stop at the innermost function, since a `break`,
 * an `await` or a `hold` can't reach past one.
 *
 * A function's header (its parameters' defaults) is no body: a default runs as code of its own,
 * with no instance's work to wait on (§3.3), as a top-level constant's value does (§3).
 */

import type { LabelledScope } from '../../../compiler/syntax/statements/index.ts';
import { bodyOf, type SyntaxNode, type SyntaxTree } from '../../../compiler/syntax/tree.ts';

export interface Surroundings {
  /** The body of the innermost function holding the position, if it is in one. */
  readonly body: 'none' | 'sync' | 'async';
  /** The loops and labelled blocks holding the position in that body, innermost first. */
  readonly scopes: readonly LabelledScope[];
}

/** What encloses the innermost of `chain`, the nodes from `tree`'s root down to the position. */
export function surroundingsOf(tree: SyntaxTree, chain: readonly SyntaxNode[]): Surroundings {
  const scopes: LabelledScope[] = [];
  for (let index = chain.length - 2; index >= 0; index -= 1) {
    const node = chain[index];
    const child = chain[index + 1];
    switch (node?.kind) {
      case 'FunctionDeclaration':
        return { body: bodyKind(bodyOf(tree, node) === child, node.isAsync), scopes };
      case 'Lambda':
        return { body: bodyKind(node.body === child, node.isAsync), scopes };
      case 'For':
      case 'While':
      case 'LabelledBlock':
        if (node.body === child) {
          scopes.push(node);
        }
        break;
      default:
        break;
    }
  }
  return { body: 'none', scopes };
}

function bodyKind(inBody: boolean, isAsync: boolean): Surroundings['body'] {
  if (!inBody) {
    return 'none';
  }
  return isAsync ? 'async' : 'sync';
}
