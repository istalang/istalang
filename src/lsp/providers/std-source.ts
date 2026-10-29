/**
 * `ista/source`: the text of a std module, by its `std:` URI, for a client to show it as a
 * read-only document when a definition leads into one. Std modules are compiled into the toolchain,
 * so no file holds them for the client to open. Any other URI has no source here (null).
 */

import { RequestType } from 'vscode-languageserver/node';
import { stdSourceOf } from '../../stdlib/stdlib-loader.ts';
import { moduleIdOfUri } from '../locations.ts';
import type { Provider } from './provider.ts';

export const stdSourceRequest = new RequestType<{ readonly uri: string }, string | null, void>(
  'ista/source',
);

export const stdSource: Provider = {
  capabilities: {},
  register: (connection) => {
    connection.onRequest(stdSourceRequest, ({ uri }) => stdSourceOf(moduleIdOfUri(uri)) ?? null);
  },
};
