/**
 * Hovers over every corpus and std module, through the protocol. Every name the identifier query
 * answers, every key the key query does, every node checking typed and every written type is shown
 * somewhere: where it is the innermost node holding the offset that has a name or a type, or, for a
 * written type, at its last name. There, a name shows each of its types, and any other node its
 * own, or those of the node it shows as (hover.ts `shownAs`): the `x->` of `x->f` none, being the
 * member read's link, as `.` is, and a deferred call the call it defers. A node holding no offset
 * (a `Missing` one) has nothing to hover over.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { type Hover, HoverRequest, MarkupContent } from 'vscode-languageserver/node';
import { checkProgram } from '../../../compiler/checker/check.ts';
import { typeText } from '../../../compiler/checker/types/type/type-text.ts';
import { wholeProgramTimeout } from '../../../compiler/compile.test-kit.ts';
import type { ModuleId } from '../../../compiler/program/program.ts';
import type { Expression } from '../../../compiler/syntax/expressions/index.ts';
import {
  nodesAt,
  nodesUnder,
  type SyntaxNode,
  type SyntaxTree,
} from '../../../compiler/syntax/tree/index.ts';
import { lastName } from '../../../compiler/syntax/tree/node.ts';
import { spanIn } from '../../../compiler/syntax/tree/positions.ts';
import type { TypeNode } from '../../../compiler/syntax/types/index.ts';
import { shownAs } from '../../language-service/hover.ts';
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
}, wholeProgramTimeout);

/** What `node` denotes: an identifier's denotations, or the field a key names (§3.1). */
function denotationsAt(module: ModuleId, node: SyntaxNode) {
  if (node.kind === 'Identifier') {
    return checker.lookup.denotationsOf(module, node);
  }
  return node.kind === 'StringLiteral' ? checker.lookup.keyDenotationsOf(module, node) : [];
}

/**
 * The types a hover over `node` must show: those of the node it shows as; undefined for a node with
 * neither a name nor a type, or that shows as none.
 */
function shownTypes(module: ModuleId, node: SyntaxNode): readonly string[] | undefined {
  const shown = shownAs(node);
  if (shown === undefined || node.span.from === node.span.to) {
    return undefined;
  }
  if (shown !== node) {
    return shownTypes(module, shown);
  }
  const denotations = denotationsAt(module, node);
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
