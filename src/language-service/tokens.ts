/**
 * The tokens of a tree's source, for features that read text the tree doesn't keep: brackets,
 * keywords, operators. Trees hold no tokens (syntax/node.ts), so they are scanned again, once per
 * tree.
 *
 * The scanner nests a template's values' tokens in the template token. Features read them in
 * place, after the template, so a value's code is found like any other.
 */

import { scan } from '../compiler/scanner/scan.ts';
import type { Token } from '../compiler/syntax/tokens.ts';
import type { SyntaxTree } from '../compiler/syntax/tree.ts';
import { memo } from '../structures/memo.ts';

const flattened = new WeakMap<SyntaxTree, readonly Token[]>();
const code = new WeakMap<SyntaxTree, readonly Token[]>();

/** Every token of `tree`'s source in order, without the `end` tokens closing each list. */
export function allTokensOf(tree: SyntaxTree): readonly Token[] {
  return memo(flattened, tree, () => flatten(scan(tree.source).tokens));
}

/**
 * The tokens of `tree`'s code: all of them but templates and docstrings, whose text is no code.
 * A template's span holds its values' tokens, so without it the tokens end in the order they start,
 * and can be searched by either.
 */
export function codeTokensOf(tree: SyntaxTree): readonly Token[] {
  return memo(code, tree, () =>
    allTokensOf(tree).filter((token) => token.kind !== 'template' && token.kind !== 'docstring'),
  );
}

function flatten(tokens: readonly Token[]): readonly Token[] {
  return tokens.flatMap((token) => {
    if (token.kind === 'end') {
      return [];
    }
    return token.kind === 'template'
      ? [token, ...token.values.flatMap((value) => flatten(value.tokens))]
      : [token];
  });
}
