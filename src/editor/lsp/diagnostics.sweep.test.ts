/**
 * The diagnostics every corpus module gets, opened in one language server over the corpus
 * project, are what `ista check` reports for it.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { corpusDirectory, corpusFiles } from '../../../test/corpus/programs.ts';
import { checked, projectProgram, uriOf } from './diagnostics.test-kit.ts';
import { connectedClient } from './server.test-kit.ts';

describe('the diagnostics an open document gets', () => {
  it('are what ista check reports for its module, for every corpus module', async () => {
    const client = await connectedClient(corpusDirectory);
    const files = corpusFiles.map(({ name, text }) => ({
      file: join(corpusDirectory, name),
      text,
    }));
    const published = Promise.all(files.map(({ file }) => client.nextDiagnostics(uriOf(file))));
    await Promise.all(files.map(({ file, text }) => client.open(uriOf(file), text)));
    const program = projectProgram(corpusDirectory);
    expect(await published).toEqual(files.map(({ file }) => checked(program, file)));
  });
});
