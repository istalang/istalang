/**
 * The tokens of a tree's source, for features that read text the tree doesn't keep: brackets,
 * keywords, operators. Trees hold no tokens (syntax/node.ts), so they are scanned again, once per
 * tree.
 *
 * Brackets pair as the parser groups them (parser/cursor.ts `skipGroup`): a closing bracket closes
 * the innermost one open of its kind, and any open inside that one stay unclosed, so an unclosed
 * bracket, as in code being typed, pairs with nothing and leaves the pairs around it intact. A
 * closing bracket with none of its kind open is passed over.
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
const closings = new WeakMap<SyntaxTree, ReadonlyMap<Token, Token>>();

const openers: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };
const openings = new Set(Object.values(openers));

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

/** Whether `token` is an opening bracket: `(`, `[` or `{`. */
export function opensBracket(token: Token): boolean {
  return openings.has(token.kind);
}

/** The bracket closing each opening bracket of `tree`'s code that one closes. */
export function closingBracketsOf(tree: SyntaxTree): ReadonlyMap<Token, Token> {
  return memo(closings, tree, () => pairedBrackets(codeTokensOf(tree)));
}

function pairedBrackets(tokens: readonly Token[]): ReadonlyMap<Token, Token> {
  const open: Token[] = [];
  const pairs = new Map<Token, Token>();
  for (const token of tokens) {
    const opener = openers[token.kind];
    if (openings.has(token.kind)) {
      open.push(token);
    } else if (opener !== undefined) {
      const innermost = open.findLastIndex((each) => each.kind === opener);
      const [paired] = innermost === -1 ? [] : open.splice(innermost);
      if (paired !== undefined) {
        pairs.set(paired, token);
      }
    }
  }
  return pairs;
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
