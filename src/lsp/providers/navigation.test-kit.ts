/** Asking a server where names lead, by LSP positions. */

import {
  DefinitionRequest,
  type Location,
  type Position,
  ReferencesRequest,
} from 'vscode-languageserver/node';
import type { StringLiteral } from '../../compiler/syntax/expressions/literals.ts';
import { type Identifier, isMissingName } from '../../compiler/syntax/node.ts';
import { nodesUnder, type SyntaxTree } from '../../compiler/syntax/tree.ts';
import { lineMapOf } from '../../text/line-map.ts';
import type { SourceText } from '../../text/source-text.ts';
import type { TestClient } from '../server.test-kit.ts';

/** Every name written in `tree`, and every String literal, which names a field where it is a key. */
export function namesOf(tree: SyntaxTree): readonly (Identifier | StringLiteral)[] {
  return nodesUnder(tree, tree.root).filter(
    (node): node is Identifier | StringLiteral =>
      (node.kind === 'Identifier' && !isMissingName(node)) || node.kind === 'StringLiteral',
  );
}

export function positionOf(source: SourceText, offset: number): Position {
  const { line, column } = lineMapOf(source).positionAt(offset);
  return { line, character: column };
}

/** A location as one comparable string. */
export function placeOf({ uri, range: { start, end } }: Location): string {
  return `${uri}:${start.line}:${start.character}-${end.line}:${end.character}`;
}

export async function definitionsAt(
  client: TestClient,
  uri: string,
  position: Position,
): Promise<readonly Location[]> {
  const found = await client.connection.sendRequest(DefinitionRequest.type, {
    textDocument: { uri },
    position,
  });
  if (found === null) {
    return [];
  }
  return Array.isArray(found) ? (found as Location[]) : [found];
}

export async function referencesAt(
  client: TestClient,
  location: Location,
  includeDeclaration: boolean,
): Promise<readonly Location[]> {
  const found = await client.connection.sendRequest(ReferencesRequest.type, {
    textDocument: { uri: location.uri },
    position: location.range.start,
    context: { includeDeclaration },
  });
  return found ?? [];
}
