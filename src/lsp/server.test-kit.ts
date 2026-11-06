/**
 * A language server in memory, and a client speaking LSP to it over two streams, as an editor
 * would over a process's pipes. No maintained harness exists for this; the client is the protocol
 * connection the library itself is built on.
 *
 * Clients are shut down once their test file is done, so one server can serve every test of a file.
 * A client never sends `exit`, which would end the test's process, as the protocol has it end the
 * server's.
 */

import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { afterAll } from 'vitest';
import {
  createConnection,
  createProtocolConnection,
  type Diagnostic,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  InitializedNotification,
  InitializeRequest,
  type InitializeResult,
  type ProtocolConnection,
  PublishDiagnosticsNotification,
  SemanticTokensRequest,
  ShutdownRequest,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';
import { addToGroup } from '../foundation/structures/groups.ts';
import { serveLanguage } from './server.ts';

const shutdowns: (() => Promise<void>)[] = [];

afterAll(async () => {
  await Promise.all(shutdowns.splice(0).map((shutdown) => shutdown()));
});

/** A client connected to a server for the project at `root`. */
export interface TestClient {
  readonly connection: ProtocolConnection;
  readonly initialized: InitializeResult;
  readonly open: (uri: string, text: string) => Promise<void>;
  /** Replaces a document's whole text, as the server asks clients to send it. */
  readonly change: (uri: string, text: string) => Promise<void>;
  readonly close: (uri: string) => Promise<void>;
  /** The next diagnostics published for `uri` after this call. */
  readonly nextDiagnostics: (uri: string) => Promise<readonly Diagnostic[]>;
  /** The tokens a document's highlighting holds, at absolute positions, by their kinds' names. */
  readonly highlighted: (uri: string) => Promise<readonly HighlightedToken[]>;
}

interface HighlightedToken {
  readonly line: number;
  readonly character: number;
  readonly length: number;
  readonly type: string;
}

/** Starts a server for the project at `root` and connects a client to it. */
export async function connectedClient(root: string): Promise<TestClient> {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  serveLanguage(
    createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient)),
    root,
  );
  const connection = createProtocolConnection(
    new StreamMessageReader(toClient),
    new StreamMessageWriter(toServer),
  );
  shutdowns.push(async () => {
    await connection.sendRequest(ShutdownRequest.type);
    connection.dispose();
    toServer.end();
  });
  const waiting = new Map<string, ((diagnostics: readonly Diagnostic[]) => void)[]>();
  connection.onNotification(PublishDiagnosticsNotification.type, ({ uri, diagnostics }) => {
    for (const resolve of waiting.get(uri)?.splice(0) ?? []) {
      resolve(diagnostics);
    }
  });
  connection.listen();
  const initialized = await connection.sendRequest(InitializeRequest.type, {
    processId: null,
    rootUri: pathToFileURL(root).href,
    capabilities: {},
    workspaceFolders: null,
  });
  await connection.sendNotification(InitializedNotification.type, {});
  const versions = new Map<string, number>();
  const nextVersion = (uri: string) => {
    const version = (versions.get(uri) ?? 0) + 1;
    versions.set(uri, version);
    return version;
  };
  return {
    connection,
    initialized,
    open: (uri, text) =>
      connection.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId: 'ista', version: nextVersion(uri), text },
      }),
    change: (uri, text) =>
      connection.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri, version: nextVersion(uri) },
        contentChanges: [{ text }],
      }),
    close: (uri) =>
      connection.sendNotification(DidCloseTextDocumentNotification.type, {
        textDocument: { uri },
      }),
    nextDiagnostics: (uri) =>
      new Promise((resolve) => {
        addToGroup(waiting, uri, resolve);
      }),
    highlighted: async (uri) => {
      const tokens = await connection.sendRequest(SemanticTokensRequest.type, {
        textDocument: { uri },
      });
      const legend = initialized.capabilities.semanticTokensProvider?.legend.tokenTypes ?? [];
      return decoded(tokens?.data ?? [], legend);
    },
  };
}

/** Semantic tokens as LSP encodes them, five numbers each relative to the token before, decoded. */
function decoded(data: readonly number[], legend: readonly string[]): readonly HighlightedToken[] {
  const tokens: HighlightedToken[] = [];
  let line = 0;
  let character = 0;
  for (let index = 0; index < data.length; index += 5) {
    const [deltaLine = 0, deltaStart = 0, length = 0, type = 0] = data.slice(index, index + 4);
    line += deltaLine;
    character = deltaLine === 0 ? character + deltaStart : deltaStart;
    tokens.push({ line, character, length, type: legend[type] ?? '' });
  }
  return tokens;
}
