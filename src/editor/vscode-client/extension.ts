/**
 * The extension's entry. Highlighting is declarative (package.json); this starts the client of
 * `ista lsp` (server-command.ts) for Istalang documents on disk, unsaved ones, and std modules.
 *
 * Std modules are compiled into the toolchain, so a definition that leads into one names a `std:`
 * URI that no file holds. A read-only content provider asks the server for its text
 * (`ista/source`); the URI ends in `.ista` (lsp/locations.ts), which marks the document as
 * Istalang before VS Code shows any of it, a definition's preview included.
 *
 * A hover's links run `ista.openLocation` (lsp/client-protocol.ts), the one command its Markdown
 * is trusted to run.
 *
 * Starting the server runs the workspace's own `ista`, so in a workspace the user hasn't trusted
 * the server waits for that trust (package.json `untrustedWorkspaces`).
 */

import { commands, type ExtensionContext, Range, Uri, window, workspace } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { stdScheme } from '../../foundation/language/well-known/index.ts';
import {
  type OpenLocationArguments,
  openLocationCommand,
  stdSourceRequest,
} from '../lsp/client-protocol.ts';
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
    markdown: { isTrusted: { enabledCommands: [openLocationCommand] } },
  });
  client = started;
  context.subscriptions.push(
    workspace.registerTextDocumentContentProvider(stdScheme, {
      provideTextDocumentContent: (uri) =>
        started.sendRequest(stdSourceRequest, { uri: uri.toString() }),
    }),
    commands.registerCommand(openLocationCommand, openLocation),
  );
  await started.start();
}

export function deactivate(): Promise<void> | undefined {
  return client?.stop();
}

async function openLocation(...[uri, line, character]: OpenLocationArguments): Promise<void> {
  const at = new Range(line, character, line, character);
  await window.showTextDocument(Uri.parse(uri), { selection: at });
}
