/**
 * Signature help at a call being typed, over the corpus's own files, through the protocol: the
 * text cut right after one of a call's arguments gets the help the same cut gets with the call
 * closed. The cut drops what follows, a function declared further down included, so the two are
 * compared with each other rather than with the whole module's help.
 *
 * It runs in slices, one per `signature-help-left-open-<n>.sweep.test.ts` beside this module
 * (test/slices.ts), each with a server of its own: every cut rebuilds and re-checks the whole
 * corpus program twice, so one server taking them all holds its worker for minutes.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { type Position, SignatureHelpRequest } from 'vscode-languageserver/node';
import { sliceOf } from '../../../../test/slices.ts';
import { nodesUnder } from '../../../compiler/syntax/tree/index.ts';
import { spanIn } from '../../../compiler/syntax/tree/positions.ts';
import type { SourceText } from '../../../foundation/text/source-text.ts';
import { corpusClient, programDocuments as documents } from '../corpus-client.test-kit.ts';
import { rangeOf } from '../locations.ts';
import type { TestClient } from '../server.test-kit.ts';
import { activeOf } from './signature-help.test-kit.ts';

/** The active signature at `position` once `client`'s text of `uri` is `text`. */
async function helpIn(client: TestClient, uri: string, text: string, position: Position) {
  await client.change(uri, text);
  return activeOf(
    await client.connection.sendRequest(SignatureHelpRequest.type, {
      textDocument: { uri },
      position,
    }),
  );
}

/**
 * Where help at the end of `source` cut at `end` differs from the help the cut closed by `)` gets.
 * The document gets its whole text back after.
 */
async function leftOpenMismatch(
  client: TestClient,
  uri: string,
  source: SourceText,
  end: number,
): Promise<readonly string[]> {
  const position = rangeOf(source, { start: end, end }).start;
  const cut = source.text.slice(0, end);
  const open = await helpIn(client, uri, cut, position);
  const closed = await helpIn(client, uri, `${cut})`, position);
  await client.change(uri, source.text);
  return open.label === closed.label && open.parameter === closed.parameter
    ? []
    : [`${open.label} [${open.parameter}] ≠ ${closed.label} [${closed.parameter}]`];
}

/** The end of every argument of every call in the corpus's own files, with where it stands. */
const argumentEnds = documents
  .filter(({ uri }) => uri.startsWith('file:'))
  .flatMap(({ uri, tree }) =>
    nodesUnder(tree, tree.root).flatMap((node) =>
      node.kind === 'Call'
        ? node.arguments.map((argument) => {
            const { end } = spanIn(tree, argument.span);
            const { line, character } = rangeOf(tree.source, { start: end, end }).start;
            return { uri, source: tree.source, end, at: `${line}:${character}` };
          })
        : [],
    ),
  );

/** Registers the cuts of the slice `file` (its `import.meta.url`), against a server of its own. */
export function leftOpenSlice(file: string): void {
  let client: TestClient;

  beforeAll(async () => {
    client = await corpusClient();
  });

  describe('signature help over the corpus', () => {
    it.each(sliceOf(file).of(argumentEnds))(
      '$uri $at, the call left open',
      async ({ uri, source, end }) => {
        expect(await leftOpenMismatch(client, uri, source, end)).toEqual([]);
      },
    );
  });
}
