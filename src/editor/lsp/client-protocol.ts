/**
 * What the server and its VS Code client (.vscode/extensions/ista) both speak beyond LSP, defined
 * once for both sides to import. So it is built from the protocol package both libraries share,
 * which pulls neither side's library into the other's code.
 *
 * - `ista/source`: the text of a std module, by its document's URI, for the client to show it as a
 *   read-only document when a definition leads into one. Std modules are compiled into the
 *   toolchain, so no file holds them for the client to open.
 * - `ista.openLocation`: the client's command opening a document at a position, which a hover's
 *   links run. A Markdown link in a hover may go only to a file or the web, never to a std
 *   module's document, while a link running a command the client trusts goes anywhere, so every
 *   link runs this one.
 */

import { RequestType } from 'vscode-languageserver-protocol';

export const stdSourceRequest = new RequestType<{ readonly uri: string }, string | null, void>(
  'ista/source',
);

export const openLocationCommand = 'ista.openLocation';

/** What `openLocationCommand` takes: a document's URI, and a line and a character in it from 0. */
export type OpenLocationArguments = readonly [uri: string, line: number, character: number];

/** A Markdown link's target running `openLocationCommand` with `location`. */
export function openLocationTarget(location: OpenLocationArguments): string {
  return `command:${openLocationCommand}?${encodeURIComponent(JSON.stringify(location))}`;
}
