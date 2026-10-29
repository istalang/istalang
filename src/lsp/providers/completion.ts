/**
 * Completion (language-service/completion.ts), as LSP's completion items. Typing `.` or the `>` of
 * `->` asks for members; a `>` that writes no `->`, as in a comparison, offers nothing.
 */

import { CompletionItemKind } from 'vscode-languageserver/node';
import {
  type CompletionKind,
  completionsAt,
  memberCompletionsAt,
} from '../../language-service/completion.ts';
import { documentOffset } from '../locations.ts';
import type { Provider } from './provider.ts';

const kinds = {
  variable: CompletionItemKind.Variable,
  function: CompletionItemKind.Function,
  method: CompletionItemKind.Method,
  field: CompletionItemKind.Field,
  type: CompletionItemKind.Class,
  variant: CompletionItemKind.EnumMember,
  module: CompletionItemKind.Module,
  keyword: CompletionItemKind.Keyword,
} as const satisfies Record<CompletionKind, CompletionItemKind>;

export const completion: Provider = {
  capabilities: { completionProvider: { triggerCharacters: ['.', '>'] } },
  register: (connection, workspace) => {
    connection.onCompletion((params) => {
      const at = documentOffset(workspace, params);
      if (at === undefined) {
        return [];
      }
      const offered =
        params.context?.triggerCharacter === '>'
          ? (memberCompletionsAt(workspace.program, at.module, at.offset) ?? [])
          : completionsAt(workspace.program, at.module, at.offset);
      return offered.map(({ name, kind, detail }) => ({
        label: name,
        kind: kinds[kind],
        ...(detail === undefined ? {} : { detail }),
      }));
    });
  },
};
