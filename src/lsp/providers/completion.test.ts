/**
 * Completion over every corpus and std module, through the protocol: at every name the binder
 * resolved by looking it up in scope, the name is offered; at every member the identifier query
 * answers, after its `.`, `?.`, `->` or `?->`, or as a qualified name's later segment in a type or
 * a pattern, the member is offered.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { type CompletionItem, CompletionRequest } from 'vscode-languageserver/node';
import { isLookedUp, resolvedNames } from '../../compiler/binder/bind.test-kit.ts';
import { checkProgram } from '../../compiler/checker/check.ts';
import type { Identifier } from '../../compiler/syntax/node.ts';
import { spanIn } from '../../compiler/syntax/positions.ts';
import { nodesUnder } from '../../compiler/syntax/tree.ts';
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

describe('completion over the corpus', () => {
  it.each(documents)('$uri', async ({ uri, module, tree }) => {
    const scoped = resolvedNames(program, module)
      .filter((resolved) => isLookedUp(program, resolved))
      .map(({ name }) => name);
    const members = nodesUnder(tree, tree.root)
      .flatMap((node) => {
        if (node.kind === 'MemberAccess') {
          return [node.member];
        }
        return node.kind === 'NamedType' || node.kind === 'NamePattern' ? node.path.slice(1) : [];
      })
      .filter((member) => checker.lookup.denotationsOf(module, member).length > 0);
    const unoffered = await Promise.all(
      [...scoped, ...members].map(async (name: Identifier) => {
        const position = rangeOf(tree.source, spanIn(tree, name.span)).end;
        const items = await client.connection.sendRequest(CompletionRequest.type, {
          textDocument: { uri },
          position,
        });
        const offered = (Array.isArray(items) ? items : (items?.items ?? [])).some(
          ({ label }: CompletionItem) => label === name.text,
        );
        return offered ? [] : [`${position.line}:${position.character} ${name.text}`];
      }),
    );
    expect(unoffered.flat()).toEqual([]);
  });
});
