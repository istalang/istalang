/**
 * Hovers over every corpus and std module, through the protocol. Every name the identifier query
 * answers, every node checking typed and every written type is shown somewhere: where it is the
 * innermost node holding the offset that has a name or a type, or, for a written type, at its last
 * name. There, a name shows each of its types, and any other node its own. A node holding no
 * offset (a `Missing` one) has nothing to hover over, and the `x->` of `x->f` is the member read's
 * link, as `.` is.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { type Hover, HoverRequest, MarkupContent } from 'vscode-languageserver/node';
import { checkProgram } from '../../compiler/checker/check.ts';
import { typeText } from '../../compiler/checker/types/type-text.ts';
import type { ModuleId } from '../../compiler/program/program.ts';
import type { Expression } from '../../compiler/syntax/expressions/index.ts';
import { lastName } from '../../compiler/syntax/node.ts';
import { spanIn } from '../../compiler/syntax/positions.ts';
import {
  nodesAt,
  nodesUnder,
  type SyntaxNode,
  type SyntaxTree,
} from '../../compiler/syntax/tree.ts';
import type { TypeNode } from '../../compiler/syntax/types.ts';
import {
  corpusClient,
  programDocuments as documents,
  corpusProgram as program,
} from '../corpus-client.test-kit.ts';
import { rangeOf } from '../locations.ts';
import type { TestClient } from '../server.test-kit.ts';

const checker = checkProgram(program);

let client: TestClient;

beforeAll(async () => {
  client = await corpusClient();
});

/** The types a hover over `node` must show; undefined for a node with neither a name nor a type. */
function shownTypes(module: ModuleId, node: SyntaxNode): readonly string[] | undefined {
  const isLink = node.kind === 'Dereference' && node.operator === '->';
  if (isLink || node.span.from === node.span.to) {
    return undefined;
  }
  const denotations = node.kind === 'Identifier' ? checker.lookup.denotationsOf(module, node) : [];
  if (denotations.length > 0) {
    return denotations.flatMap(({ type }) => (type === undefined ? [] : typeText(type)));
  }
  const typed =
    checker.lookup.bodyHolding(module, node)?.typeOf(node as Expression) ??
    checker.lookup.typeOfNode(module, node as TypeNode);
  return typed && [typeText(typed)];
}

/** Each node a hover shows, with the first offset it is shown at. */
function shownAt(
  tree: SyntaxTree,
  shown: (node: SyntaxNode) => readonly string[] | undefined,
): ReadonlyMap<SyntaxNode, number> {
  const offsets = new Map<SyntaxNode, number>();
  for (let offset = 0; offset < tree.source.text.length; offset += 1) {
    const node = nodesAt(tree, offset)
      .toReversed()
      .find((each) => shown(each) !== undefined);
    if (node !== undefined && !offsets.has(node)) {
      offsets.set(node, offset);
    }
  }
  return offsets;
}

function shownText(hover: Hover | null): string {
  return hover !== null && MarkupContent.is(hover.contents) ? hover.contents.value : '';
}

describe('hover over the corpus', () => {
  it.each(documents)('$uri', async ({ uri, module, tree }) => {
    const types = new Map<SyntaxNode, readonly string[] | undefined>();
    const shown = (node: SyntaxNode) => {
      if (!types.has(node)) {
        types.set(node, shownTypes(module, node));
      }
      return types.get(node);
    };
    const offsets = shownAt(tree, shown);
    const wrong = await Promise.all(
      nodesUnder(tree, tree.root).map(async (node) => {
        const texts = shown(node);
        const offset =
          offsets.get(node) ??
          (node.kind === 'NamedType' ? offsets.get(lastName(node.path)) : undefined);
        const { line, character } = rangeOf(tree.source, spanIn(tree, node.span)).start;
        if (texts === undefined) {
          return [];
        }
        if (offset === undefined) {
          return [`${line}:${character} ${node.kind} is shown nowhere`];
        }
        const position = rangeOf(tree.source, { start: offset, end: offset }).start;
        const hover = shownText(
          await client.connection.sendRequest(HoverRequest.type, {
            textDocument: { uri },
            position,
          }),
        );
        const absent = texts.filter((text) => !hover.includes(text));
        return absent.length === 0 ? [] : [`${position.line}:${position.character} ${absent}`];
      }),
    );
    expect(wrong.flat()).toEqual([]);
  });
});
