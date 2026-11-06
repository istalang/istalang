import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PublishDiagnosticsNotification, ShutdownRequest } from 'vscode-languageserver/node';
import { brokenText } from '../../../test/broken.ts';
import { corpusDirectory, corpusFiles } from '../../../test/corpus/programs.ts';
import { diagnoseModule } from '../../compiler/compile.ts';
import type { Program } from '../../compiler/program/program.ts';
import { lineMapOf } from '../../foundation/text/line-map.ts';
import { moduleIdOfFile } from '../../project/file-loader.ts';
import { tempProject } from '../../project/project.test-kit.ts';
import { findProjectSources, loadProject } from '../../project/project.ts';
import { connectedClient } from './server.test-kit.ts';

/** What `ista check` reports in `file` of `program`, as a client receives it. */
function checked(program: Program, file: string) {
  const { source, diagnostics } = diagnoseModule(program, moduleIdOfFile(file));
  const lines = lineMapOf(source);
  const position = (offset: number) => {
    const { line, column } = lines.positionAt(offset);
    return { line, character: column };
  };
  return diagnostics.map(({ span, severity, code, message }) => ({
    range: { start: position(span.start), end: position(span.end) },
    severity: severity === 'error' ? 1 : 2,
    code,
    source: 'ista',
    message,
  }));
}

/** What `ista check` reports in a project's `main.ista`. */
function checkedMain(root: string) {
  const main = join(root, 'main.ista');
  return checked(loadProject(root, findProjectSources(root)).program, main);
}

const uriOf = (file: string) => pathToFileURL(file).href;

describe('the diagnostics an open document gets', () => {
  it('are what ista check reports for its module, for every corpus module', async () => {
    const client = await connectedClient(corpusDirectory);
    const files = corpusFiles.map(({ name, text }) => ({
      file: join(corpusDirectory, name),
      text,
    }));
    const published = Promise.all(files.map(({ file }) => client.nextDiagnostics(uriOf(file))));
    await Promise.all(files.map(({ file, text }) => client.open(uriOf(file), text)));
    const { program } = loadProject(corpusDirectory, findProjectSources(corpusDirectory));
    expect(await published).toEqual(files.map(({ file }) => checked(program, file)));
  });

  it("follow each change, as ista check would report the changed file's", async () => {
    const root = tempProject({ 'main.ista': '' });
    const uri = uriOf(join(root, 'main.ista'));
    const client = await connectedClient(root);
    const opened = client.nextDiagnostics(uri);
    await client.open(uri, '');
    await opened;
    await fc.assert(
      fc.asyncProperty(brokenText(corpusFiles.map(({ text }) => text)), async (text) => {
        const published = client.nextDiagnostics(uri);
        await client.change(uri, text);
        expect(await published).toEqual(checkedMain(tempProject({ 'main.ista': text })));
      }),
      { numRuns: 25 },
    );
  });

  it('follow a change to a module they import', async () => {
    const root = tempProject({
      'lib.ista': 'fn helper() -> Int: 1\n',
      'main.ista': "import helper from 'lib'\n\nfn main() -> Int: helper()\n",
    });
    const client = await connectedClient(root);
    const main = uriOf(join(root, 'main.ista'));
    const lib = uriOf(join(root, 'lib.ista'));
    const clean = client.nextDiagnostics(main);
    await client.open(main, "import helper from 'lib'\n\nfn main() -> Int: helper()\n");
    await client.open(lib, 'fn helper() -> Int: 1\n');
    expect(await clean).toEqual([]);
    const afterRename = client.nextDiagnostics(main);
    await client.change(lib, 'fn renamed() -> Int: 1\n');
    expect((await afterRename).length).toBeGreaterThan(0);
  });

  it('stop once the client shuts the server down, even for a change just made', async () => {
    const root = tempProject({ 'main.ista': '' });
    const uri = uriOf(join(root, 'main.ista'));
    const client = await connectedClient(root);
    const published: unknown[] = [];
    client.connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
      published.push(params);
    });
    await client.open(uri, 'fn main() -> Int: "one"\n');
    await client.connection.sendRequest(ShutdownRequest.type);
    await setTimeout(100);
    expect(published).toEqual([]);
  });

  it('are cleared when it closes, and its file is read from disk again', async () => {
    const root = tempProject({ 'main.ista': 'fn main() -> Int: 1\n' });
    const uri = uriOf(join(root, 'main.ista'));
    const client = await connectedClient(root);
    const broken = client.nextDiagnostics(uri);
    await client.open(uri, 'fn main() -> Int: "one"\n');
    expect(await broken).toEqual(
      checkedMain(tempProject({ 'main.ista': 'fn main() -> Int: "one"\n' })),
    );
    const cleared = client.nextDiagnostics(uri);
    await client.close(uri);
    expect(await cleared).toEqual([]);
  });
});
