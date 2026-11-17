import { beforeAll, describe, expect, it } from 'vitest';
import { DocumentFormattingRequest } from 'vscode-languageserver/node';
import { wholeProgramTimeout } from '../../../compiler/compile.test-kit.ts';
import { formatTree } from '../../../formatter/format.ts';
import { corpusClient, corpusDocuments } from '../corpus-client.test-kit.ts';
import type { TestClient } from '../server.test-kit.ts';

let client: TestClient;

beforeAll(async () => {
  client = await corpusClient();
}, wholeProgramTimeout);

describe('formatting a document', () => {
  it.each(corpusDocuments)(
    'gives the canonical format as one edit of the whole text, or none: $uri',
    async ({ uri, text, tree }) => {
      const edits =
        (await client.connection.sendRequest(DocumentFormattingRequest.type, {
          textDocument: { uri },
          options: { tabSize: 8, insertSpaces: false },
        })) ?? [];
      const formatted = formatTree(tree) ?? text;
      const lines = text.split('\n');
      const whole = {
        start: { line: 0, character: 0 },
        end: { line: lines.length - 1, character: lines.at(-1)?.length },
      };
      expect(edits).toEqual(formatted === text ? [] : [{ range: whole, newText: formatted }]);
    },
  );
});
