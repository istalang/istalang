/**
 * Completion (language-service/completion.ts), as LSP's completion items. Typing `.` or the `>` of
 * `->` asks for members; a `>` that writes no `->`, as in a comparison, offers nothing. Typing the
 * `{` or a `,` of a struct literal asks for the fields it doesn't give yet; anywhere else, as in a
 * block or a call, either offers nothing.
 */

import { CompletionItemKind } from 'vscode-languageserver/node';
import {
  type CompletionKind,
  completionsAt,
  fieldCompletionsAt,
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

/** What typing a trigger character asks for, where it narrows what completion offers. */
const narrowing: Readonly<Record<string, typeof memberCompletionsAt>> = {
  '>': memberCompletionsAt,
  '{': fieldCompletionsAt,
  ',': fieldCompletionsAt,
};

export const completion: Provider = {
  capabilities: { completionProvider: { triggerCharacters: ['.', ...Object.keys(narrowing)] } },
  register: (connection, workspace) => {
    connection.onCompletion((params) => {
      const at = documentOffset(workspace, params);
      if (at === undefined) {
        return [];
      }
      const trigger = params.context?.triggerCharacter;
      const narrowed = trigger === undefined ? undefined : narrowing[trigger];
      const offered =
        narrowed === undefined
          ? completionsAt(workspace.program, at.module, at.offset)
          : (narrowed(workspace.program, at.module, at.offset) ?? []);
      return offered.map(({ name, kind, detail }) => ({
        label: name,
        kind: kinds[kind],
        ...(detail === undefined ? {} : { detail }),
      }));
    });
  },
};
