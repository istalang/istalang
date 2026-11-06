/**
 * The extension's entry. Highlighting is declarative (package.json); this starts the client of
 * `ista lsp` (server-command.ts) for Istalang documents on disk, unsaved ones, and std modules.
 *
 * Std modules are compiled into the toolchain, so a definition that leads into one names a `std:`
 * URI that no file holds. A read-only content provider asks the server for its text
 * (`ista/source`), and the document is marked as Istalang, which a name without an extension
 * can't tell.
 *
 * Starting the server runs the workspace's own `ista`, so in a workspace the user hasn't trusted
 * the server waits for that trust (package.json `untrustedWorkspaces`).
 */

import { type ExtensionContext, languages, type TextDocument, workspace } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { stdScheme } from '../language/well-known/index.ts';
import { stdSourceRequest } from '../lsp/std-source-request.ts';
import { serverExecutable } from './server-command.ts';

const language = 'ista';

/** The running client, which `deactivate` stops; VS Code awaits that stop, not a disposal. */
let client: LanguageClient | undefined;

export async function activate(context: ExtensionContext): Promise<void> {
  if (!workspace.isTrusted) {
    context.subscriptions.push(workspace.onDidGrantWorkspaceTrust(() => activate(context)));
    return;
  }
  const folder = workspace.workspaceFolders?.[0]?.uri.fsPath;
  const setting = workspace.getConfiguration('ista').get<string>('server.path', '');
  const started = new LanguageClient(language, 'Istalang', serverExecutable(setting, folder), {
    documentSelector: [
      { scheme: 'file', language },
      { scheme: 'untitled', language },
      { scheme: stdScheme, language },
    ],
  });
  client = started;
  context.subscriptions.push(
    workspace.registerTextDocumentContentProvider(stdScheme, {
      provideTextDocumentContent: (uri) =>
        started.sendRequest(stdSourceRequest, { uri: uri.toString() }),
    }),
    workspace.onDidOpenTextDocument(markStdModule),
  );
  await started.start();
}

export function deactivate(): Promise<void> | undefined {
  return client?.stop();
}

function markStdModule(document: TextDocument): void {
  if (document.uri.scheme === stdScheme && document.languageId !== language) {
    languages.setTextDocumentLanguage(document, language);
  }
}
