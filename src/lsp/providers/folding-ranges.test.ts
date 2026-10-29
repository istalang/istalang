import { beforeAll, describe, expect, it } from 'vitest';
import { FoldingRangeRequest } from 'vscode-languageserver/node';
import { childrenOf, type SyntaxNode, type SyntaxTree } from '../../compiler/syntax/tree.ts';
import { allTokensOf } from '../../language-service/tokens.ts';
import { lineMapOf } from '../../text/line-map.ts';
import type { Span } from '../../text/span.ts';
import { corpusClient, corpusDocuments } from '../corpus-client.test-kit.ts';
import type { TestClient } from '../server.test-kit.ts';

let client: TestClient;

beforeAll(async () => {
  client = await corpusClient();
});

interface Fold {
  readonly startLine: number;
  readonly endLine: number;
}

/** What must fold, and the earliest line its fold may start on: any line up to the one it starts on. */
interface Foldable {
  readonly what: string;
  readonly span: Span;
  readonly earliest: number;
}

/** Constructs whose items fold: a declaration's members, a `match`'s or a `select`'s cases. */
const itemLists = new Set([
  'StructDeclaration',
  'SharedStructDeclaration',
  'EnumDeclaration',
  'Variant',
  'TraitDeclaration',
  'Match',
  'Select',
]);

function descendants(node: SyntaxNode): readonly SyntaxNode[] {
  return childrenOf(node).flatMap((child) => [child, ...descendants(child)]);
}

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
  return descendants(tree.root).flatMap((node) => {
    const named = itemLists.has(node.kind) && 'name' in node ? node.name : undefined;
    const indented = node.kind === 'Block' && tree.source.text[node.span.start] !== '{';
    const colon = indented
      ? colons.findLast((token) => token.span.end <= node.span.start)
      : undefined;
    const header = itemLists.has(node.kind) ? (named ?? node) : colon;
    if (header === undefined) {
      return [];
    }
    const span = { start: header.span.start, end: node.span.end };
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
    (await client.connection.sendRequest(FoldingRangeRequest.type, { textDocument: { uri } })) ?? []
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
