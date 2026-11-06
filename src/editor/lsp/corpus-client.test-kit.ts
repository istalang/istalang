/**
 * Every corpus module and every std module open in one server, for properties over all of them
 * through the protocol. The corpus directory is the project, as `ista check` there sees it; std
 * modules are open under their `std:` URIs, as a client shows them when a definition leads there.
 */

import { pathToFileURL } from 'node:url';
import { corpusDirectory, corpusFiles } from '../../../test/corpus/programs.ts';
import { parse } from '../../compiler/parser/parse.ts';
import type { ModuleId, Program } from '../../compiler/program/program.ts';
import { scan } from '../../compiler/scanner/scan.ts';
import type { SyntaxTree } from '../../compiler/syntax/tree/index.ts';
import { createSourceText } from '../../foundation/text/source-text.ts';
import { stdModuleSources } from '../../stdlib/std-sources.ts';
import { moduleIdOfUri } from './locations.ts';
import { projectProgramLoader } from './project-loader.ts';
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

/** The corpus project as `ista check` loads it, which the corpus client's documents equal. */
export const corpusProgram: Program = projectProgramLoader(corpusDirectory)(new Map(), undefined);

/** A document of `corpusDocuments` that `corpusProgram` holds, with its module and tree there. */
export interface ProgramDocument {
  readonly uri: string;
  readonly module: ModuleId;
  readonly tree: SyntaxTree;
}

/**
 * Every document of `corpusDocuments` that `corpusProgram` holds: what a test states answers from.
 */
export const programDocuments: readonly ProgramDocument[] = corpusDocuments.flatMap(({ uri }) => {
  const module = moduleIdOfUri(uri);
  const tree = corpusProgram.modules.get(module)?.tree;
  return tree === undefined ? [] : [{ uri, module, tree }];
});
