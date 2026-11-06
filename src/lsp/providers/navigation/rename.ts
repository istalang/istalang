/**
 * Renaming what a name denotes across the project (language-service/navigation/rename.ts). The
 * client asks first whether the name can be renamed, so a refusal reaches its user, with the
 * reason, before a new name is typed.
 */

import {
  type Connection,
  LSPErrorCodes,
  ResponseError,
  type TextEdit,
  type WorkspaceEdit,
} from 'vscode-languageserver/node';
import type { Program } from '../../../compiler/program/program.ts';
import { programModule } from '../../../compiler/program/program.ts';
import { spelledName } from '../../../language-service/navigation/declarations.ts';
import {
  type NameEdit,
  type Refusal,
  renameEdits,
  renamingAt,
} from '../../../language-service/navigation/rename.ts';
import type { Workspace } from '../../../language-service/workspace.ts';
import { addToGroup } from '../../../structures/groups.ts';
import { documentOffset, locationOf, rangeOf } from '../../locations.ts';
import type { Provider } from '../provider.ts';

export const rename: Provider = {
  capabilities: { renameProvider: { prepareProvider: true } },
  register: (connection, workspace) => {
    answerPreparing(connection, workspace);
    answerRenaming(connection, workspace);
  },
};

function answerPreparing(connection: Connection, workspace: Workspace): void {
  connection.onPrepareRename((params) => {
    const at = documentOffset(workspace, params);
    if (at === undefined) {
      return null;
    }
    const { program } = workspace;
    const renaming = renamingAt(program, at.module, at.offset);
    if (renaming === undefined) {
      return null;
    }
    if (renaming.kind === 'refused') {
      return failed(renaming);
    }
    const { name } = renaming;
    return {
      range: locationOf(program, at.module, name.span).range,
      placeholder: spelledName(name),
    };
  });
}

function answerRenaming(connection: Connection, workspace: Workspace): void {
  connection.onRenameRequest((params) => {
    const at = documentOffset(workspace, params);
    const { program } = workspace;
    const renamed = at && renameEdits(program, at.module, at.offset, params.newName);
    if (renamed === undefined) {
      return null;
    }
    return renamed.kind === 'refused' ? failed(renamed) : workspaceEdit(program, renamed.edits);
  });
}

function failed({ reason }: Refusal): ResponseError {
  return new ResponseError(LSPErrorCodes.RequestFailed, reason);
}

function workspaceEdit(program: Program, edits: readonly NameEdit[]): WorkspaceEdit {
  const changes = new Map<string, TextEdit[]>();
  for (const { module, span, text } of edits) {
    const range = rangeOf(programModule(program, module).tree.source, span);
    addToGroup(changes, module, { range, newText: text });
  }
  return { changes: Object.fromEntries(changes) };
}
