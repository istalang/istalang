/**
 * Every provider over any text an edit can leave in the editor: broken programs, either line
 * break, and text beyond ASCII before them, so positions in UTF-16 are exercised.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DocumentFormattingRequest,
  DocumentSymbolRequest,
  FoldingRangeRequest,
} from 'vscode-languageserver/node';
import { brokenText } from '../../../test/broken.ts';
import { corpusFiles } from '../../../test/corpus/programs.ts';
import { tempProject } from '../../project/project.test-kit.ts';
import { connectedClient } from '../server.test-kit.ts';

const lineBreaks = /\r\n|\n/u;

describe('every provider, over a document edited into brokenness', () => {
  it('answers, with folds inside the text and no token crossing its line', async () => {
    const root = tempProject({ 'main.ista': '' });
    const uri = pathToFileURL(join(root, 'main.ista')).href;
    const textDocument = { uri };
    const client = await connectedClient(root);
    await client.open(uri, '');
    await fc.assert(
      fc.asyncProperty(
        brokenText(corpusFiles.map(({ text }) => text)),
        fc.constantFrom('\n', '\r\n'),
        async (text, lineBreak) => {
          const edited = `# é𝒳 ${lineBreak}${text.replaceAll('\n', lineBreak)}`;
          const published = client.nextDiagnostics(uri);
          await client.change(uri, edited);
          await published;
          const lines = edited.split(lineBreaks);
          const [symbols, folds, highlighted, edits] = await Promise.all([
            client.connection.sendRequest(DocumentSymbolRequest.type, { textDocument }),
            client.connection.sendRequest(FoldingRangeRequest.type, { textDocument }),
            client.highlighted(uri),
            client.connection.sendRequest(DocumentFormattingRequest.type, {
              textDocument,
              options: { tabSize: 2, insertSpaces: true },
            }),
          ]);
          expect(Array.isArray(symbols)).toBe(true);
          const outside = (folds ?? []).filter(
            (fold) => fold.startLine >= fold.endLine || fold.endLine >= lines.length,
          );
          const crossing = highlighted.filter(
            ({ line, character, length }) => character + length > (lines[line]?.length ?? -1),
          );
          expect({ outside, crossing }).toEqual({ outside: [], crossing: [] });
          expect((edits ?? []).length).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 40 },
    );
  });
});
