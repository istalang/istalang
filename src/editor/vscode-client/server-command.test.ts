/**
 * The process the extension starts for a workspace. The last test starts the one the setting names
 * when it is the toolchain just built, so the client's way of starting a server is held to a real
 * one.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ExitNotification, InitializeRequest, ShutdownRequest } from 'vscode-languageserver/node';
import { builtCli } from '../../cli/cli.test-kit.ts';
import { clientOf, initializeParams } from '../../cli/commands/lsp.test-kit.ts';
import { tempProject } from '../../project/project.test-kit.ts';
import { serverExecutable } from './server-command.ts';

describe('the language server the extension starts', () => {
  it('is `ista lsp --stdio` from the setting, run in the workspace folder', () => {
    const root = tempProject({});
    expect(serverExecutable('/opt/ista/bin/ista', root)).toEqual({
      command: '/opt/ista/bin/ista',
      args: ['lsp', '--stdio'],
      options: { cwd: root },
    });
  });

  it("is the workspace's own ista when the setting is empty", () => {
    const root = tempProject({ 'node_modules/.bin/ista': '' });
    expect(serverExecutable('', root).command).toBe(join(root, 'node_modules', '.bin', 'ista'));
  });

  it('is ista from the PATH when the workspace has none, or there is no workspace', () => {
    expect(serverExecutable('', tempProject({})).command).toBe('ista');
    expect(serverExecutable('', undefined)).toEqual({
      command: 'ista',
      args: ['lsp', '--stdio'],
      options: {},
    });
  });

  it('starts a server that answers and ends as the protocol says', async () => {
    const { command, args = [], options } = serverExecutable(builtCli, tempProject({}));
    const { client, exited } = clientOf(spawn(command, args, options));
    const { capabilities } = await client.sendRequest(InitializeRequest.type, initializeParams);
    expect(capabilities.documentSymbolProvider).toBe(true);
    await client.sendRequest(ShutdownRequest.type);
    await client.sendNotification(ExitNotification.type);
    expect(await exited).toBe(0);
  });
});
