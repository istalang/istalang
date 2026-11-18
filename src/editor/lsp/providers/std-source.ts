/**
 * Answers `ista/source` (client-protocol.ts) from the std sources the toolchain ships. Any URI
 * other than a std module's has no source here (null).
 */

import { stdSourceOf } from '../../../stdlib/stdlib-loader.ts';
import { stdSourceRequest } from '../client-protocol.ts';
import { moduleIdOfUri } from '../locations.ts';
import type { Provider } from './provider.ts';

export const stdSource: Provider = {
  capabilities: {},
  register: (connection) => {
    connection.onRequest(stdSourceRequest, ({ uri }) => stdSourceOf(moduleIdOfUri(uri)) ?? null);
  },
};
