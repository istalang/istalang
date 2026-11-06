import { beforeAll, describe, expect, it } from 'vitest';
import { scan } from '../../compiler/scanner/scan.ts';
import { isKeyword, type Token } from '../../compiler/syntax/tokens/index.ts';
import { nodesUnder, type SyntaxNode, type SyntaxTree } from '../../compiler/syntax/tree/index.ts';
import { spanIn } from '../../compiler/syntax/tree/positions.ts';
import { lineMapOf } from '../../foundation/text/line-map.ts';
import { corpusClient, corpusDocuments } from '../corpus-client.test-kit.ts';
import type { TestClient } from '../server.test-kit.ts';

let client: TestClient;

beforeAll(async () => {
  client = await corpusClient();
});

const punctuation = new Set(['(', ')', '[', ']', '{', '}', ',', ':', ';', '.']);
const literals = {
  integer: 'number',
  float: 'number',
  duration: 'number',
  string: 'string',
  docstring: 'string',
  template: 'string',
};

/** Whether `token` stands between the two sides of a comparison or a shift. */
function comparesAt(tree: SyntaxTree, token: Token): boolean {
  const between = (left: SyntaxNode, right: SyntaxNode) =>
    spanIn(tree, left.span).end <= token.span.start &&
    token.span.end <= spanIn(tree, right.span).start;
  return nodesUnder(tree, tree.root).some((node) => {
    if (node.kind === 'Binary') {
      return between(node.left, node.right);
    }
    if (node.kind === 'CompareFieldPattern') {
      return between(node.field, node.value);
    }
    const { operands } = node.kind === 'ChainedComparison' ? node : { operands: [] };
    return operands.some(
      (operand, index) => index > 0 && between(operands[index - 1] ?? operand, operand),
    );
  });
}

const angles = new Set(['<', '>', '>>']);

/** The kind a token must be shown as: `undefined` for punctuation, `''` for a name, of any kind. */
function expectedType(token: Token, tree: SyntaxTree): string | undefined {
  if (angles.has(token.kind) && !comparesAt(tree, token)) {
    // Brackets around a list of types.
    return undefined;
  }
  if (token.kind in literals) {
    return literals[token.kind as keyof typeof literals];
  }
  if (token.kind === 'identifier') {
    return '';
  }
  if (isKeyword(token.kind)) {
    return 'keyword';
  }
  if (token.kind === '@') {
    return 'decorator';
  }
  return punctuation.has(token.kind) ? undefined : 'operator';
}

/** Every token of a text, a template's values' tokens included, but not the ends of lists. */
function allTokens(tokens: readonly Token[]): readonly Token[] {
  return tokens.flatMap((token) => [
    ...(token.kind === 'end' || token.kind === 'unknown' ? [] : [token]),
    ...(token.kind === 'template' ? token.values.flatMap((value) => allTokens(value.tokens)) : []),
  ]);
}

describe('highlighting', () => {
  it.each(corpusDocuments)(
    'gives every token but punctuation a kind: $uri',
    async ({ uri, tree }) => {
      const decoded = await client.highlighted(uri);
      const shownAt = new Map(
        decoded.map((token) => [`${token.line}:${token.character}`, token.type]),
      );
      const lines = lineMapOf(tree.source);
      const keyOf = (offset: number) => {
        const { line, column } = lines.positionAt(offset);
        return `${line}:${column}`;
      };
      // Each token as `kind at line:column shown as type`, the type a name may have as its own.
      const shown = (token: Token) => {
        const type = shownAt.get(keyOf(token.span.start));
        const named = token.kind === 'identifier' && type !== undefined;
        return `${token.kind} at ${keyOf(token.span.start)} shown as ${named ? '' : type}`;
      };
      const expected = (token: Token) =>
        `${token.kind} at ${keyOf(token.span.start)} shown as ${expectedType(token, tree)}`;
      const tokens = allTokens(scan(tree.source).tokens);
      expect(tokens.map(shown)).toEqual(tokens.map(expected));
      const comments = tree.comments.map(({ span }) => shownAt.get(keyOf(span.start)));
      expect(comments).toEqual(tree.comments.map(() => 'comment'));
    },
  );

  it.each(corpusDocuments)('never overlaps or crosses a line: $uri', async ({ uri, tree }) => {
    const decoded = await client.highlighted(uri);
    const lines = lineMapOf(tree.source);
    const crossing = decoded.filter(({ line, character, length }) => {
      const start = lines.offsetAt({ line, column: character });
      return start + length > lines.offsetAt({ line, column: Number.MAX_SAFE_INTEGER });
    });
    const overlapping = decoded.filter((token, index) => {
      const next = decoded[index + 1];
      return next?.line === token.line && next.character < token.character + token.length;
    });
    expect({ crossing, overlapping }).toEqual({ crossing: [], overlapping: [] });
  });
});
