/** Asking a server where names lead, by LSP positions. */

import {
  DefinitionRequest,
  type Location,
  type Position,
  ReferencesRequest,
} from 'vscode-languageserver/node';
import { type Identifier, isMissingName } from '../../compiler/syntax/node.ts';
import { nodesUnder, type SyntaxTree } from '../../compiler/syntax/tree.ts';
import { lineMapOf } from '../../text/line-map.ts';
import type { SourceText } from '../../text/source-text.ts';
import type { TestClient } from '../server.test-kit.ts';

/** Every name written in `tree`. */
export function namesOf(tree: SyntaxTree): readonly Identifier[] {
  return nodesUnder(tree.root).filter(
    (node): node is Identifier => node.kind === 'Identifier' && !isMissingName(node),
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
