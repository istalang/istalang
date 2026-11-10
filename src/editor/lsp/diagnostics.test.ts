/**
 * The diagnostics a language server publishes for an open document, as `ista check` would report
 * them: after each change, after a change to an imported module, cleared on close, and none once
 * the client shut the server down. Every corpus module's is diagnostics.sweep.test.ts's.
 */

import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PublishDiagnosticsNotification, ShutdownRequest } from 'vscode-languageserver/node';
import { brokenText } from '../../../test/broken.ts';
import { corpusFiles } from '../../../test/corpus/programs.ts';
import { tempProject } from '../../project/project.test-kit.ts';
import { checked, projectProgram, uriOf } from './diagnostics.test-kit.ts';
import { connectedClient } from './server.test-kit.ts';

/** What `ista check` reports in a project's `main.ista`. */
function checkedMain(root: string) {
  return checked(projectProgram(root), join(root, 'main.ista'));
}

describe('the diagnostics an open document gets', () => {
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
