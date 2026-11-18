/**
 * What each feature of the server is: the capability it announces when a client connects, and the
 * handlers answering the client's requests for it. The server lists every provider once
 * (server.ts), so adding a feature is adding a provider, and its capability can't be announced
 * without its handlers or the other way around.
 */

import type {
  ClientCapabilities,
  Connection,
  ServerCapabilities,
} from 'vscode-languageserver/node';
import type { Workspace } from '../../language-service/workspace.ts';

export interface Provider {
  readonly capabilities: ServerCapabilities;
  /** Registers the handlers, answering as the client's capabilities let them. */
  readonly register: (
    connection: Connection,
    workspace: Workspace,
    client: ClientCapabilities,
  ) => void;
}
