/**
 * `ista lsp` as an editor starts it: a process of its own, speaking LSP over its standard input and
 * output to a client. What each feature answers belongs to lsp/'s tests; here the process serves
 * a session, and ends as the protocol says it must.
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DidOpenTextDocumentNotification,
  DocumentSymbolRequest,
  ExitNotification,
  InitializeRequest,
  PublishDiagnosticsNotification,
  ShutdownRequest,
} from 'vscode-languageserver/node';
import { tempProject } from '../../project/project.test-kit.ts';
import { builtCli } from '../cli.test-kit.ts';
import { clientOf, initializeParams } from './lsp.test-kit.ts';

/** `ista lsp --stdio` started in `root`, with a client connected to its pipes. */
function startedServer(root: string) {
  return clientOf(spawn(process.execPath, [builtCli, 'lsp', '--stdio'], { cwd: root }));
}

describe('ista lsp', () => {
  it('serves the project it runs in, and exits cleanly once shut down', async () => {
    const text = "import helper from 'lib'\n\nfn main() -> int: helper()\n";
    const root = tempProject({ 'main.ista': text, 'lib.ista': 'fn helper() -> int: 1\n' });
    const uri = pathToFileURL(`${root}/main.ista`).href;
    const { client, exited } = startedServer(root);
    const { capabilities } = await client.sendRequest(InitializeRequest.type, initializeParams);
    expect(capabilities.documentSymbolProvider).toBe(true);
    const published = new Promise((resolve) => {
      client.onNotification(PublishDiagnosticsNotification.type, ({ diagnostics }) => {
        resolve(diagnostics);
      });
    });
    await client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri, languageId: 'ista', version: 1, text },
    });
    const symbols = await client.sendRequest(DocumentSymbolRequest.type, { textDocument: { uri } });
    expect(symbols?.map((symbol) => symbol.name)).toEqual(['lib', 'main']);
    // Its import resolves only from the directory the server runs in, the project's root.
    expect(await published).toEqual([]);
    await client.sendRequest(ShutdownRequest.type);
    await client.sendNotification(ExitNotification.type);
    expect(await exited).toBe(0);
  });

  it('ends when its input does, as when the editor that started it is gone', async () => {
    const root = tempProject({});
    const server = spawn(process.execPath, [builtCli, 'lsp'], { cwd: root });
    server.stdin.end();
    const [code] = await once(server, 'exit');
    expect(code).toBe(0);
  });

  it('exits with an error when the client leaves without shutting it down', async () => {
    const { client, exited } = startedServer(tempProject({}));
    await client.sendRequest(InitializeRequest.type, initializeParams);
    await client.sendNotification(ExitNotification.type);
    expect(await exited).toBe(1);
  });
});
