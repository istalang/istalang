/**
 * Every corpus module and every std module open in one server, for properties over all of them
 * through the protocol. The corpus directory is the project, as `ista check` there sees it; std
 * modules are open under their `std:` URIs, as a client shows them when a definition leads there.
 */

import { pathToFileURL } from 'node:url';
import { corpusDirectory, corpusFiles } from '../../test/corpus/programs.ts';
import { parse } from '../compiler/parser/parse.ts';
import { scan } from '../compiler/scanner/scan.ts';
import type { SyntaxTree } from '../compiler/syntax/tree.ts';
import { stdModuleSources } from '../stdlib/std-sources.ts';
import { createSourceText } from '../text/source-text.ts';
import { connectedClient, type TestClient } from './server.test-kit.ts';

export interface OpenDocument {
  readonly uri: string;
  readonly text: string;
  /** The document parsed on its own, to state what the server must answer. */
  readonly tree: SyntaxTree;
}

/** Every corpus module, by its file's URI, then every std module, by its `std:` URI. */
export const corpusDocuments: readonly OpenDocument[] = [
  ...corpusFiles.map(({ name, text }) =>
    openDocument(pathToFileURL(`${corpusDirectory}${name}`).href, text),
  ),
  ...Object.entries(stdModuleSources).map(([name, text]) => openDocument(`std:${name}`, text)),
];

function openDocument(uri: string, text: string): OpenDocument {
  const source = createSourceText(uri, text);
  return { uri, text, tree: parse(source, scan(source)) };
}

/** A client of a server for the corpus directory, with every document of `corpusDocuments` open. */
export async function corpusClient(): Promise<TestClient> {
  const client = await connectedClient(corpusDirectory);
  await Promise.all(corpusDocuments.map(({ uri, text }) => client.open(uri, text)));
  return client;
}
