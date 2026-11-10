/**
 * What a rewrite pass is: a function from one Istalang source, read as every phase reads it, to the
 * rewrites it wants there. The rewriter applies them wherever the source sits (a file of its own, a
 * spec example, a TypeScript literal), so a pass knows nothing of files.
 *
 * A pass gets both the scanner's tokens and the parser's tree: a pass about words whose grammar is
 * changing reads tokens, which mean the same under either grammar, and a pass about constructs
 * reads the tree. Tokens are the scanner's top-level list; a template's values hold their own.
 *
 * A rewrite groups the edits of one change, applied all together or not at all, so a source is
 * never left half rewritten when one of them can't be made in its file. Its rule names it in
 * reports.
 */

import { parse } from '../../src/compiler/parser/parse.ts';
import { scan } from '../../src/compiler/scanner/scan.ts';
import type { Token } from '../../src/compiler/syntax/tokens/index.ts';
import type { SyntaxTree } from '../../src/compiler/syntax/tree/index.ts';
import { createSourceText, type SourceText } from '../../src/foundation/text/source-text.ts';
import type { Span } from '../../src/foundation/text/span.ts';

/** An Istalang source as a pass reads it. */
export interface IstaSource {
  readonly source: SourceText;
  readonly tokens: readonly Token[];
  readonly tree: SyntaxTree;
}

/** Replaces the text under `span` with `text`; an empty span inserts. */
export interface Edit {
  readonly span: Span;
  readonly text: string;
}

/** The edits of one change, which apply together or not at all. */
export interface Rewrite {
  readonly rule: string;
  readonly edits: readonly Edit[];
}

export type Pass = (source: IstaSource) => readonly Rewrite[];

/** `text` scanned and parsed, as `path` labels it. */
export function readIsta(path: string, text: string): IstaSource {
  const source = createSourceText(path, text);
  const scanned = scan(source);
  return { source, tokens: scanned.tokens, tree: parse(source, scanned) };
}

/** The edit inserting `text` at `offset`. */
export function insertion(offset: number, text: string): Edit {
  return { span: { start: offset, end: offset }, text };
}
