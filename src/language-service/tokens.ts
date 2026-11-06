/**
 * The tokens of a tree's source, for features that read text the tree doesn't keep: brackets,
 * keywords, operators. Trees hold no tokens (syntax/node.ts), so they are scanned again, once per
 * tree.
 *
 * Brackets pair as the parser pairs them (parser/brackets/brackets.ts `pairBrackets`), so a feature
 * sees the groups the parser read: an unclosed bracket, as in code being typed, pairs with nothing
 * and leaves the pairs around it intact. A template's value pairs its own, as the parser reads it.
 *
 * The scanner nests a template's values' tokens in the template token. Features read them in
 * place, after the template, so a value's code is found like any other.
 */

import { isBracketOpener, pairBrackets } from '../compiler/parser/brackets/brackets.ts';
import { scan } from '../compiler/scanner/scan.ts';
import type { ScanResult, Token } from '../compiler/syntax/tokens.ts';
import type { SyntaxTree } from '../compiler/syntax/tree.ts';
import { memo } from '../structures/memo.ts';
import { lineMapOf } from '../text/line-map.ts';

const scans = new WeakMap<SyntaxTree, ScanResult>();
const flattened = new WeakMap<SyntaxTree, readonly Token[]>();
const code = new WeakMap<SyntaxTree, readonly Token[]>();
const closings = new WeakMap<SyntaxTree, ReadonlyMap<Token, Token>>();

/** Every token of `tree`'s source in order, without the `end` tokens closing each list. */
export function allTokensOf(tree: SyntaxTree): readonly Token[] {
  return memo(flattened, tree, () => flatten(scannedOf(tree).tokens));
}

function scannedOf(tree: SyntaxTree): ScanResult {
  return memo(scans, tree, () => scan(tree.source));
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

/** The bracket closing each opening bracket of `tree`'s code that one closes. */
export function closingBracketsOf(tree: SyntaxTree): ReadonlyMap<Token, Token> {
  return memo(closings, tree, () => {
    const lineMap = lineMapOf(tree.source);
    return closingsIn(
      scannedOf(tree).tokens,
      (token) => lineMap.positionAt(token.span.start).column,
    );
  });
}

/** The closing bracket of each opening one in `tokens`, and in their templates' values. */
function closingsIn(
  tokens: readonly Token[],
  columnOf?: (token: Token) => number,
): ReadonlyMap<Token, Token> {
  const { partnerOf } = pairBrackets(tokens, columnOf);
  return new Map(
    tokens.flatMap((token, index): (readonly [Token, Token])[] => {
      if (token.kind === 'template') {
        return token.values.flatMap((value) => [...closingsIn(value.tokens)]);
      }
      const closing = isBracketOpener(token.kind) ? tokens[partnerOf(index) ?? -1] : undefined;
      return closing === undefined ? [] : [[token, closing]];
    }),
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
