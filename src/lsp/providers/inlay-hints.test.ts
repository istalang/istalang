/**
 * Inlay hints over every corpus and std module, through the protocol: exactly the names a `let`
 * or `const` leaves untyped, a `for` binds, or an untyped lambda parameter declares, each with
 * the type checking declared it with.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { InlayHintRequest } from 'vscode-languageserver/node';
import { checkProgram } from '../../compiler/checker/check.ts';
import { typeText } from '../../compiler/checker/types/type-text.ts';
import { parameterNames } from '../../compiler/syntax/expressions/parameters.ts';
import { type Identifier, isMissingName } from '../../compiler/syntax/node.ts';
import { targetNames } from '../../compiler/syntax/patterns.ts';
import { spanIn } from '../../compiler/syntax/positions.ts';
import { declaredTargets } from '../../compiler/syntax/statements/targets.ts';
import { nodesUnder, type SyntaxNode } from '../../compiler/syntax/tree.ts';
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

function untypedNames(node: SyntaxNode): readonly Identifier[] {
  if (node.kind === 'VariableDeclaration' && node.type === undefined) {
    return node.targets.flatMap(targetNames);
  }
  if (node.kind === 'For' || node.kind === 'FieldHeader') {
    return declaredTargets(node).flatMap(targetNames);
  }
  if (node.kind === 'Lambda') {
    return node.parameters.flatMap((parameter) =>
      parameter.kind === 'Parameter' && parameter.type === undefined
        ? parameterNames(parameter)
        : [],
    );
  }
  return [];
}

describe('inlay hints over the corpus', () => {
  it.each(documents)('$uri', async ({ uri, module, tree }) => {
    const hintAt = (offset: number, label: string) => {
      const { line, character } = rangeOf(tree.source, { start: offset, end: offset }).start;
      return `${line}:${character}${label}`;
    };
    const expected = nodesUnder(tree, tree.root)
      .flatMap(untypedNames)
      .filter((name) => !isMissingName(name))
      .flatMap((name) => {
        const type = checker.lookup.bodyHolding(module, name)?.declaredTypeOf(name);
        return type === undefined || type.kind === 'error'
          ? []
          : [hintAt(spanIn(tree, name.span).end, `: ${typeText(type)}`)];
      });
    const hints = await client.connection.sendRequest(InlayHintRequest.type, {
      textDocument: { uri },
      range: rangeOf(tree.source, { start: 0, end: tree.source.text.length }),
    });
    const shown = (hints ?? []).map(
      ({ position, label }) => `${position.line}:${position.character}${String(label)}`,
    );
    expect(shown.toSorted()).toEqual(expected.toSorted());
  });
});
