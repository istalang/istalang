import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { DocumentFormattingRequest } from 'vscode-languageserver/node';
import { tempProject } from '../../project/project.test-kit.ts';
import { connectedClient } from '../server.test-kit.ts';

it('formats an unformatted CRLF document with one edit ending at the text end', async () => {
  const root = tempProject({ 'main.ista': '' });
  const uri = pathToFileURL(join(root, 'main.ista')).href;
  const client = await connectedClient(root);
  const text = 'fn   main( ) -> int: 1\r\n\r\n\r\n\r\n# é𝒳 end';
  await client.open(uri, text);
  const edits = await client.connection.sendRequest(DocumentFormattingRequest.type, {
    textDocument: { uri },
    options: { tabSize: 2, insertSpaces: true },
  });
  expect(edits).toHaveLength(1);
  expect(edits?.[0]?.range).toEqual({
    start: { line: 0, character: 0 },
    end: { line: 4, character: '# é𝒳 end'.length },
  });
  expect(edits?.[0]?.newText).not.toBe(text);
});
