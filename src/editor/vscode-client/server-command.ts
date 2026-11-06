/**
 * How the extension starts the language server: `ista lsp --stdio`, run in the workspace's first
 * folder, because the server serves the project of the directory it starts in.
 *
 * The executable is the `ista.server.path` setting when one is set. Otherwise it is the workspace's
 * own toolchain (`node_modules/.bin/ista`), so a project is checked by the version it depends on,
 * and failing that, `ista` from the PATH. A relative setting is spawned from the folder, so it
 * names a path inside it.
 *
 * Nothing here imports `vscode`, so a test can start what this returns without an editor.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Executable } from 'vscode-languageclient/node';

/** The `ista lsp` process for a workspace whose first folder is `folder`, given the setting. */
export function serverExecutable(setting: string, folder: string | undefined): Executable {
  return {
    command: istaCommand(setting, folder),
    args: ['lsp', '--stdio'],
    options: folder === undefined ? {} : { cwd: folder },
  };
}

function istaCommand(setting: string, folder: string | undefined): string {
  if (setting !== '') {
    return setting;
  }
  const local = folder === undefined ? undefined : join(folder, 'node_modules', '.bin', 'ista');
  return local !== undefined && existsSync(local) ? local : 'ista';
}
