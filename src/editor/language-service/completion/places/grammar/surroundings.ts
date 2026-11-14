/**
 * What encloses a position, read from the nodes holding the placeholder: the body it runs in, the
 * scopes a label may name around it, and whether a transient may stand there (§3.4). All stop at the
 * innermost function, since a `break`, an `await` or a `hold` can't reach past one.
 *
 * A function's header (its parameters' defaults) is code that runs but never waits: the callee
 * computes a default before its body starts (§3.3), as what builds a struct or a variant computes
 * its fields' (§3.1). So is a context constant's value, made at its first read (§3.4). Only a
 * top-level constant's value, computed when the program compiles (§3), runs in no code.
 */

import { isDefaultOf } from '../../../../../compiler/syntax/declarations/index.ts';
import type { LabelledScope } from '../../../../../compiler/syntax/statements/index.ts';
import { leadsFunctionBody } from '../../../../../compiler/syntax/statements/readings.ts';
import { awaits } from '../../../../../compiler/syntax/tokens/modifiers.ts';
import {
  bodyOf,
  type SyntaxNode,
  type SyntaxTree,
} from '../../../../../compiler/syntax/tree/index.ts';

export interface Surroundings {
  /**
   * The code holding the position: an async function's body, other code that runs (`sync`), or
   * none, a top-level constant's value.
   */
  readonly body: 'none' | 'sync' | 'async';
  /** The loops and labelled blocks holding the position in that body, innermost first. */
  readonly scopes: readonly LabelledScope[];
  /** Whether the statement holding the position leads its function's body, as a transient does. */
  readonly leadsBody: boolean;
}

/** What encloses the innermost of `chain`, the nodes from `tree`'s root down to the position. */
export function surroundingsOf(tree: SyntaxTree, chain: readonly SyntaxNode[]): Surroundings {
  const block = chain.findLastIndex((node) => node.kind === 'Block');
  const statement = block === -1 ? undefined : chain[block + 1];
  const leadsBody =
    statement !== undefined && leadsFunctionBody(chain.slice(0, block + 2).toReversed());
  const scopes: LabelledScope[] = [];
  for (let index = chain.length - 2; index >= 0; index -= 1) {
    const node = chain[index];
    const child = chain[index + 1];
    switch (node?.kind) {
      case 'FunctionDeclaration':
        return {
          body: bodyKind(bodyOf(tree, node) === child, awaits(node.qualifiers)),
          scopes,
          leadsBody,
        };
      case 'Lambda':
        return {
          body: bodyKind(node.body === child, awaits(node.qualifiers)),
          scopes,
          leadsBody,
        };
      case 'ContextConstantDeclaration':
        return { body: 'sync', scopes, leadsBody };
      case 'DeclaredField':
        if (isDefaultOf(node, child)) {
          return { body: 'sync', scopes, leadsBody };
        }
        break;
      case 'For':
      case 'FieldLoop':
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
  return { body: 'none', scopes, leadsBody };
}

/** A function's code: its body waits where the function is async, its header never. */
function bodyKind(inBody: boolean, isAsync: boolean): Surroundings['body'] {
  return inBody && isAsync ? 'async' : 'sync';
}
