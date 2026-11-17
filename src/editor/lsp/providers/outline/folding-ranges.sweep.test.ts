import { describe, expect, it } from 'vitest';
import { FoldingRangeRequest } from 'vscode-languageserver/node';
import { extentIn, nodesUnder, type SyntaxTree } from '../../../../compiler/syntax/tree/index.ts';
import { spanIn } from '../../../../compiler/syntax/tree/positions.ts';
import { lineMapOf } from '../../../../foundation/text/line-map.ts';
import type { Span } from '../../../../foundation/text/span.ts';
import { allTokensOf } from '../../../language-service/reading/tokens.ts';
import { corpusDocuments, sharedCorpusClient } from '../../corpus-client.test-kit.ts';

const client = sharedCorpusClient();

interface Fold {
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * What must fold, and the earliest line its fold may start on: any line up to the one it starts on.
 */
interface Foldable {
  readonly what: string;
  readonly span: Span;
  readonly earliest: number;
}

/** Constructs whose items fold: a declaration's members, a `match`'s or a `select`'s cases. */
const itemLists = new Set([
  'StructDeclaration',
  'SharedStructDeclaration',
  'ExternStructDeclaration',
  'EnumDeclaration',
  'Variant',
  'TraitDeclaration',
  'Match',
  'Select',
]);

/**
 * Indented blocks, from the line of the `:` before them, docstrings or comments between; item
 * lists, a declaration's from the line naming it, below any annotation. A braced block is a
 * bracket pair.
 */
function layoutFoldables(
  tree: SyntaxTree,
  lineOf: (offset: number) => number,
): readonly Foldable[] {
  const colons = allTokensOf(tree).filter((token) => token.kind === ':');
  return nodesUnder(tree, tree.root).flatMap((node) => {
    const named = itemLists.has(node.kind) && 'name' in node ? node.name : undefined;
    const { start } = spanIn(tree, node.span);
    const indented = node.kind === 'Block' && tree.source.text[start] !== '{';
    const colon = indented ? colons.findLast((token) => token.span.end <= start) : undefined;
    const header = itemLists.has(node.kind) ? spanIn(tree, (named ?? node).span) : colon?.span;
    if (header === undefined) {
      return [];
    }
    const span = { start: header.start, end: extentIn(tree, node).end };
    return [{ what: node.kind, span, earliest: lineOf(span.start) }];
  });
}

/** Every bracket pair, from its opener's line. */
function bracketFoldables(
  tree: SyntaxTree,
  lineOf: (offset: number) => number,
): readonly Foldable[] {
  const open: { kind: string; start: number }[] = [];
  return allTokensOf(tree).flatMap((token) => {
    if (token.kind === '(' || token.kind === '[' || token.kind === '{') {
      open.push({ kind: token.kind, start: token.span.start });
    }
    const opener = ')]}'.includes(token.kind) ? open.pop() : undefined;
    return opener === undefined
      ? []
      : [
          {
            what: opener.kind,
            span: { start: opener.start, end: token.span.end },
            earliest: lineOf(opener.start),
          },
        ];
  });
}

async function foldsOf(uri: string): Promise<readonly Fold[]> {
  return (
    (await client().connection.sendRequest(FoldingRangeRequest.type, { textDocument: { uri } })) ??
    []
  );
}

describe('folding', () => {
  it.each(corpusDocuments)(
    'covers every block, item list and bracket list spanning lines: $uri',
    async ({ uri, tree }) => {
      const folds = await foldsOf(uri);
      const lines = lineMapOf(tree.source);
      const lineOf = (offset: number) => lines.positionAt(offset).line;
      const uncovered = [
        ...layoutFoldables(tree, lineOf),
        ...bracketFoldables(tree, lineOf),
      ].flatMap(({ what, span, earliest }) => {
        const first = lineOf(span.start);
        const last = lineOf(Math.max(span.start, span.end - 1));
        const covered = folds.some(
          (fold) => fold.startLine >= earliest && fold.startLine <= first && fold.endLine >= last,
        );
        return last === first || covered ? [] : [`${what} on lines ${first}-${last}`];
      });
      expect(uncovered).toEqual([]);
    },
  );

  it.each(corpusDocuments)(
    'folds nothing within one line, and once per line: $uri',
    async ({ uri }) => {
      const folds = await foldsOf(uri);
      expect(folds.filter((fold) => fold.endLine <= fold.startLine)).toEqual([]);
      expect(new Set(folds.map((fold) => fold.startLine)).size).toBe(folds.length);
    },
  );
});
