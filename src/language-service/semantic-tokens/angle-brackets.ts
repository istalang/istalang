/**
 * The `<` and `>` tokens enclosing a list of types (`Map<K, V>`, `fn f<T>`, `f<Int>()`): brackets
 * there, not the comparisons the same tokens are elsewhere. Only the tree knows which they are, by
 * the lists it holds: the token before a list's first type opens it, and the first token ending
 * past its last type closes it. One `>>` token can close two lists at once (`Array<Array<Int>>`).
 */

import type { Token } from '../../compiler/syntax/tokens/index.ts';
import { nodesUnder, type SyntaxNode, type SyntaxTree } from '../../compiler/syntax/tree/index.ts';
import { spanIn } from '../../compiler/syntax/tree/positions.ts';
import { memo } from '../../structures/memo.ts';
import { lastIndexAtMost } from '../../structures/sorted.ts';
import { codeTokensOf } from '../tokens.ts';

const angleTokens: ReadonlySet<string> = new Set(['<', '>', '>>']);

const brackets = new WeakMap<SyntaxTree, ReadonlySet<Token>>();

/** Every token of `tree` that brackets a list of types. */
export function angleBracketsOf(tree: SyntaxTree): ReadonlySet<Token> {
  return memo(brackets, tree, () => {
    const tokens = codeTokensOf(tree);
    const found = new Set<Token>();
    for (const node of nodesUnder(tree, tree.root)) {
      for (const token of bracketsAround(tree, typeListOf(node), tokens)) {
        found.add(token);
      }
    }
    return found;
  });
}

/** The types a node lists between `<` and `>`: its type parameters, or its type arguments. */
function typeListOf(node: SyntaxNode): readonly SyntaxNode[] {
  if ('typeParameters' in node) {
    return node.typeParameters;
  }
  return 'typeArguments' in node ? node.typeArguments : [];
}

/** The tokens opening and closing a list of `types`, among `tokens` ordered by their ends. */
function bracketsAround(
  tree: SyntaxTree,
  types: readonly SyntaxNode[],
  tokens: readonly Token[],
): readonly Token[] {
  const [first] = types;
  const last = types.at(-1);
  if (first === undefined || last === undefined) {
    return [];
  }
  const lastEndingBy = (offset: number) =>
    lastIndexAtMost(tokens, (token) => token.span.end, offset);
  const around = [
    tokens[lastEndingBy(spanIn(tree, first.span).start)],
    tokens[lastEndingBy(spanIn(tree, last.span).end) + 1],
  ];
  return around.filter(
    (token): token is Token => token !== undefined && angleTokens.has(token.kind),
  );
}
