/**
 * Going to a definition for a client taking links: each spans the whole declaration, which an
 * editor previews, and lands on its name. Where every name leads is definition.sweep.test.ts's.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DefinitionRequest, type LocationLink } from 'vscode-languageserver/node';
import { tempProject } from '../../../../project/project.test-kit.ts';
import { fileUriOf } from '../../diagnostics.test-kit.ts';
import { connectedClient, sharedClient } from '../../server.test-kit.ts';

const text = [
  'struct Pair:',
  '  first: Int',
  '  second: Int',
  '',
  'fn total(pair: Pair) -> Int:',
  '  const (a, b) = (pair.first, pair.second)',
  '  a + b',
  '',
  'fn main() -> Int: total(Pair{first: 1, second: 2})',
  '',
].join('\n');

const root = tempProject({ 'main.ista': text });
const uri = fileUriOf(join(root, 'main.ista'));
const client = sharedClient(() =>
  connectedClient(root, { textDocument: { definition: { linkSupport: true } } }),
);

async function linksAt(line: number, character: number): Promise<readonly LocationLink[]> {
  await client().open(uri, text);
  const found = await client().connection.sendRequest(DefinitionRequest.type, {
    textDocument: { uri },
    position: { line, character },
  });
  return (found ?? []) as LocationLink[];
}

const range = (line: number, character: number, endLine: number, endCharacter: number) => ({
  start: { line, character },
  end: { line: endLine, character: endCharacter },
});

describe('going to a definition, for a client taking links', () => {
  it("spans a function's whole declaration, body included, and lands on its name", async () => {
    expect(await linksAt(8, 19)).toEqual([
      {
        originSelectionRange: range(8, 18, 8, 23),
        targetUri: uri,
        targetRange: range(4, 0, 6, 7),
        targetSelectionRange: range(4, 3, 4, 8),
      },
    ]);
  });

  it("spans a struct's fields, a field's line and a destructured name's declaration", async () => {
    const [struct] = await linksAt(4, 16);
    expect(struct?.targetRange).toEqual(range(0, 0, 2, 13));
    const [field] = await linksAt(5, 23);
    expect(field?.targetRange).toEqual(range(1, 2, 1, 12));
    const [bound] = await linksAt(6, 2);
    expect(bound?.targetRange).toEqual(range(5, 2, 5, 42));
  });
});
