/**
 * `ista/source`: the text of a std module, by its `std:` URI, for a client to show it as a
 * read-only document when a definition leads into one. Std modules are compiled into the toolchain,
 * so no file holds them for the client to open.
 *
 * Both sides of the protocol import this one definition: the server (providers/std-source.ts) and
 * the VS Code client (.vscode/extensions/ista). So it is built from the protocol package both
 * libraries share, which pulls neither side's library into the other's code.
 */

import { RequestType } from 'vscode-languageserver-protocol';

export const stdSourceRequest = new RequestType<{ readonly uri: string }, string | null, void>(
  'ista/source',
);
