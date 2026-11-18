import { describe, expect, it } from 'vitest';
import { DocumentFormattingRequest } from 'vscode-languageserver/node';
import { formatModule } from '../../../formatter/format.ts';
import { corpusDocuments, sharedCorpusClient } from '../corpus-client.test-kit.ts';

const client = sharedCorpusClient();

describe('formatting a document', () => {
  it.each(corpusDocuments)(
    'gives the canonical format as one edit of the whole text, or none, as its banner asks: $uri',
    async ({ uri, text, tree }) => {
      const edits =
        (await client().connection.sendRequest(DocumentFormattingRequest.type, {
          textDocument: { uri },
          options: { tabSize: 8, insertSpaces: false },
        })) ?? [];
      const formatted = formatModule(tree) ?? text;
      const lines = text.split('\n');
      const whole = {
        start: { line: 0, character: 0 },
        end: { line: lines.length - 1, character: lines.at(-1)?.length },
      };
      expect(edits).toEqual(formatted === text ? [] : [{ range: whole, newText: formatted }]);
    },
  );
});
