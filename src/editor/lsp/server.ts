/**
 * The language server: one project, its open documents, and every feature over them.
 *
 * The connection is the app's to make (`ista lsp` makes it over standard input and output; tests
 * over streams in memory), so this module knows no transport. The project is the client's first
 * workspace folder, or the directory the server runs in when the client names none. The client
 * sends each document's whole text on every change: an edit is replaced, never applied, so the
 * workspace's texts can't drift from the editor's.
 */

import { fileURLToPath } from 'node:url';
import {
  type Connection,
  type InitializeParams,
  type ServerCapabilities,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { Workspace } from '../language-service/workspace.ts';
import { diagnosticsPublisher } from './diagnostics.ts';
import { moduleIdOfUri } from './locations.ts';
import { projectProgramLoader } from './project-loader.ts';
import { completion } from './providers/completion.ts';
import { formatting } from './providers/formatting.ts';
import { hover } from './providers/hover.ts';
import { inlayHints } from './providers/inlay-hints.ts';
import { definition } from './providers/navigation/definition.ts';
import { references } from './providers/navigation/references.ts';
import { rename } from './providers/navigation/rename.ts';
import { documentSymbols } from './providers/outline/document-symbols.ts';
import { foldingRanges } from './providers/outline/folding-ranges.ts';
import type { Provider } from './providers/provider.ts';
import { semanticTokens } from './providers/semantic-tokens.ts';
import { signatureHelp } from './providers/signature-help.ts';
import { stdSource } from './providers/std-source.ts';

const providers: readonly Provider[] = [
  documentSymbols,
  foldingRanges,
  semanticTokens,
  formatting,
  stdSource,
  definition,
  references,
  rename,
  hover,
  inlayHints,
  signatureHelp,
  completion,
];

/** Serves the language over `connection`, for the project the client opens, else `cwd`. */
export function serveLanguage(connection: Connection, cwd: string): void {
  connection.onInitialize((params) => {
    const workspace = new Workspace(projectProgramLoader(projectRootOf(params, cwd)));
    syncDocuments(connection, workspace);
    for (const provider of providers) {
      provider.register(connection, workspace);
    }
    const capabilities: ServerCapabilities = Object.assign(
      { textDocumentSync: TextDocumentSyncKind.Full },
      ...providers.map((provider) => provider.capabilities),
    );
    return { capabilities, serverInfo: { name: 'ista' } };
  });
  connection.listen();
}

function projectRootOf(params: InitializeParams, cwd: string): string {
  const uri = params.workspaceFolders?.[0]?.uri ?? params.rootUri;
  return uri === undefined || uri === null ? cwd : fileURLToPath(uri);
}

/**
 * Keeps the workspace's texts as the client's, publishing diagnostics after every change until
 * shutdown.
 */
function syncDocuments(connection: Connection, workspace: Workspace): void {
  const diagnostics = diagnosticsPublisher(connection, workspace);
  connection.onDidOpenTextDocument(({ textDocument }) => {
    workspace.write(moduleIdOfUri(textDocument.uri), textDocument.text);
    diagnostics.schedule();
  });
  connection.onDidChangeTextDocument(({ textDocument, contentChanges }) => {
    const change = contentChanges.at(-1);
    if (change !== undefined) {
      workspace.write(moduleIdOfUri(textDocument.uri), change.text);
      diagnostics.schedule();
    }
  });
  connection.onDidCloseTextDocument(({ textDocument }) => {
    const module = moduleIdOfUri(textDocument.uri);
    workspace.close(module);
    diagnostics.clear(module);
    diagnostics.schedule();
  });
  connection.onShutdown(() => {
    diagnostics.stop();
  });
}
