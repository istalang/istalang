/**
 * How a token-based pass reads a source: as runs of tokens, the source's own and each template
 * value's, the scanner nesting a value's tokens in its template's. Each run's brackets pair as the
 * parser pairs them (parser/cursor/brackets.ts `pairBrackets`), the source's by indentation where
 * one is left open, so a pass sees the groups the parser reads.
 */

import {
  bracketClosers,
  isBracketOpener,
  pairBrackets,
} from '../../src/compiler/parser/cursor/brackets.ts';
import type { Token } from '../../src/compiler/syntax/tokens/index.ts';
import { lineMapOf } from '../../src/foundation/text/line-map.ts';
import type { SourceText } from '../../src/foundation/text/source-text.ts';
import { textOf } from '../../src/foundation/text/span.ts';
import type { IstaSource } from './pass.ts';

/** One token list of a source, ending with its `end` token. */
export interface TokenRun {
  readonly source: SourceText;
  readonly tokens: readonly Token[];
  /** The index of the bracket paired with the one at `index`; undefined if it pairs with none. */
  readonly partnerOf: (index: number) => number | undefined;
}

/** The runs of `source`: its own tokens first, then each template value's, outermost first. */
export function tokenRunsOf({ source, tokens }: IstaSource): readonly TokenRun[] {
  const lineMap = lineMapOf(source);
  const top = runOf(source, tokens, (token) => lineMap.positionAt(token.span.start).column);
  return [top, ...valueRunsIn(source, tokens)];
}

function runOf(
  source: SourceText,
  tokens: readonly Token[],
  columnOf?: (token: Token) => number,
): TokenRun {
  return { source, tokens, partnerOf: pairBrackets(tokens, columnOf).partnerOf };
}

function valueRunsIn(source: SourceText, tokens: readonly Token[]): readonly TokenRun[] {
  return tokens.flatMap((token) =>
    token.kind === 'template'
      ? token.values.flatMap((value) => [
          runOf(source, value.tokens),
          ...valueRunsIn(source, value.tokens),
        ])
      : [],
  );
}

/** The text of the token at `index`; empty past the run's end. */
export function wordAt(run: TokenRun, index: number): string {
  const token = run.tokens[index];
  return token === undefined ? '' : textOf(run.source, token.span);
}

/** The column the token at `index` starts at. */
export function columnAt(run: TokenRun, index: number): number {
  return lineMapOf(run.source).positionAt(run.tokens[index]?.span.start ?? 0).column;
}

/** Whether the token at `index` opens a bracket. */
export function opensBracket(run: TokenRun, index: number): boolean {
  return isBracketOpener(run.tokens[index]?.kind ?? '');
}

const closers: ReadonlySet<string> = new Set(bracketClosers.values());

/** Whether the token at `index` closes a bracket. */
export function closesBracket(run: TokenRun, index: number): boolean {
  return closers.has(run.tokens[index]?.kind ?? '');
}

/**
 * The index past the token at `index`, and past its whole group if it opens a bracket; undefined
 * for a bracket nothing closes.
 */
export function pastToken(run: TokenRun, index: number): number | undefined {
  if (!opensBracket(run, index)) {
    return index + 1;
  }
  const partner = run.partnerOf(index);
  return partner === undefined ? undefined : partner + 1;
}
