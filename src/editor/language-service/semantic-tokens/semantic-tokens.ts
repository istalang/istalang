/**
 * Highlighting from syntax: every token of a file, and every comment, with the kind it is shown
 * as, in source order.
 *
 * Keywords, literals, comments and operators are known from the token alone. A name takes its role
 * from the tree (name-types.ts); a contextual word (§2) the tree holds no name for is acting as a
 * keyword there, such as `new` before a struct literal. Brackets and separators have no kind:
 * they are punctuation, which an editor's grammar colors already.
 *
 * A template is one token holding its values' tokens. Its quotes and text are a string, its values
 * are highlighted as code, and the `${` and `}` around them are punctuation. So are the `<` and `>`
 * around a list of types (angle-brackets.ts), which are comparisons elsewhere.
 */

import { isContextualWord, isKeyword, type Token } from '../../../compiler/syntax/tokens/index.ts';
import type { SyntaxTree } from '../../../compiler/syntax/tree/index.ts';
import type { SourceText } from '../../../foundation/text/source-text.ts';
import { type Span, textOf } from '../../../foundation/text/span.ts';
import { allTokensOf } from '../reading/tokens.ts';
import { angleBracketsOf } from './angle-brackets.ts';
import { nameTypesOf } from './name-types.ts';
import type { SemanticType } from './semantic-types.ts';

interface ClassifiedSpan {
  readonly span: Span;
  readonly type: SemanticType;
}

/** Punctuators that structure code rather than compute: brackets, separators, member access. */
const punctuation: ReadonlySet<string> = new Set([
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  ':',
  ';',
  '.',
]);

/** Every token and comment of `tree` that has a kind, in source order. */
export function semanticTokensOf(tree: SyntaxTree): readonly ClassifiedSpan[] {
  const context = {
    names: nameTypesOf(tree),
    angleBrackets: angleBracketsOf(tree),
    source: tree.source,
  };
  const classified = (token: Token): readonly ClassifiedSpan[] => {
    if (token.kind === 'template') {
      return templateStrings(token);
    }
    const type = typeOf(token, context);
    return type === undefined ? [] : [{ span: token.span, type }];
  };
  return [
    ...allTokensOf(tree).flatMap(classified),
    ...tree.comments.map(({ span }) => ({ span, type: 'comment' as const })),
  ].sort((first, second) => first.span.start - second.span.start);
}

interface Classification {
  readonly names: ReadonlyMap<number, SemanticType>;
  readonly angleBrackets: ReadonlySet<Token>;
  readonly source: SourceText;
}

/** The kind of a token other than a template; undefined for punctuation and the end. */
function typeOf(
  token: Token,
  { names, angleBrackets, source }: Classification,
): SemanticType | undefined {
  switch (token.kind) {
    case 'identifier':
      return (
        names.get(token.span.start) ??
        (isContextualWord(textOf(source, token.span)) ? 'keyword' : 'variable')
      );
    case 'integer':
    case 'float':
    case 'duration':
      return 'number';
    case 'string':
    case 'docstring':
      return 'string';
    case 'unknown':
    case 'end':
      return;
    case '@':
      return 'decorator';
    default:
      if (isKeyword(token.kind)) {
        return 'keyword';
      }
      return punctuation.has(token.kind) || angleBrackets.has(token) ? undefined : 'operator';
  }
}

/** A template's quotes and text, around its values. */
function templateStrings(
  token: Extract<Token, { readonly kind: 'template' }>,
): readonly ClassifiedSpan[] {
  const strings: ClassifiedSpan[] = [];
  let { start } = token.span;
  for (const value of token.values) {
    strings.push({ span: { start, end: value.span.start }, type: 'string' });
    start = value.span.end;
  }
  strings.push({ span: { start, end: token.span.end }, type: 'string' });
  return strings.filter(({ span }) => span.end > span.start);
}
