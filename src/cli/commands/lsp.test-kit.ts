/**
 * A language server as an editor runs it: a process of its own, with a client on its pipes. The
 * command's tests start it as `ista lsp`; the VS Code client's start it the way the extension
 * does.
 */

import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import {
  createProtocolConnection,
  type InitializeParams,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';

/** A client connected to `server`'s pipes, and the code the server exits with. */
export function clientOf(server: ChildProcessWithoutNullStreams) {
  const client = createProtocolConnection(
    new StreamMessageReader(server.stdout),
    new StreamMessageWriter(server.stdin),
  );
  client.listen();
  const exited = once(server, 'exit').then(([code]) => code as number | null);
  return { client, exited };
}

/** What a client with no capabilities and no workspace says when it initializes. */
export const initializeParams: InitializeParams = {
  processId: null,
  rootUri: null,
  capabilities: {},
};
