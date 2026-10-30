/**
 * Completion (language-service/completion/), as LSP's completion items: the one place the item
 * model meets the protocol's encoding. The client is told to ask on the service's trigger
 * characters, and a request names the character typed, since the service answers a typed one only
 * at the places it opens.
 *
 * What follows an item's acceptance is a command the client runs: VS Code's, which other clients
 * ignore. A rank becomes a `sortText` ordering by rank, then by name.
 */

import {
  type Command,
  type CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
} from 'vscode-languageserver/node';
import { completionsAt } from '../../language-service/completion/index.ts';
import {
  type Completion,
  type CompletionKind,
  type FollowUp,
  type Insertion,
  lowestPriority,
  type Rank,
  rankKeys,
} from '../../language-service/completion/item.ts';
import { completionTriggers } from '../../language-service/completion/triggers.ts';
import { importableStdModules } from '../../stdlib/stdlib-loader.ts';
import { documentOffset } from '../locations.ts';
import type { Provider } from './provider.ts';

export const completion: Provider = {
  capabilities: { completionProvider: { triggerCharacters: [...completionTriggers] } },
  register: (connection, workspace) => {
    connection.onCompletion((params) => {
      const at = documentOffset(workspace, params);
      return at === undefined
        ? []
        : completionsAt(workspace.program, at.module, at.offset, {
            ...(params.context?.triggerCharacter === undefined
              ? {}
              : { trigger: params.context.triggerCharacter }),
            stdModules: importableStdModules,
          }).map(completionItem);
    });
  },
};

const kinds = {
  variable: CompletionItemKind.Variable,
  constant: CompletionItemKind.Constant,
  function: CompletionItemKind.Function,
  method: CompletionItemKind.Method,
  field: CompletionItemKind.Field,
  struct: CompletionItemKind.Struct,
  enum: CompletionItemKind.Enum,
  trait: CompletionItemKind.Interface,
  type: CompletionItemKind.Class,
  typeParameter: CompletionItemKind.TypeParameter,
  variant: CompletionItemKind.EnumMember,
  module: CompletionItemKind.Module,
  keyword: CompletionItemKind.Keyword,
} as const satisfies Record<CompletionKind, CompletionItemKind>;

const followUps = {
  completion: { title: 'Complete', command: 'editor.action.triggerSuggest' },
  signatureHelp: { title: 'Signature help', command: 'editor.action.triggerParameterHints' },
} as const satisfies Record<FollowUp, Command>;

/** `offered` as the protocol's item. */
export function completionItem(offered: Completion): CompletionItem {
  const { name, kind, detail, documentation, insert, next, rank, preselect, commit } = offered;
  return {
    label: name,
    kind: kinds[kind],
    ...(detail === undefined ? {} : { detail }),
    ...(documentation === undefined
      ? {}
      : { documentation: { kind: MarkupKind.Markdown, value: documentation } }),
    ...(insert === undefined ? {} : insertion(insert)),
    ...(next === undefined ? {} : { command: followUps[next] }),
    ...(rank === undefined ? {} : { sortText: sortText(rank, name) }),
    ...(preselect === undefined ? {} : { preselect }),
    ...(commit === undefined ? {} : { commitCharacters: [...commit] }),
  };
}

function insertion(insert: Insertion): Pick<CompletionItem, 'insertText' | 'insertTextFormat'> {
  return insert.kind === 'text'
    ? { insertText: insert.text, insertTextFormat: InsertTextFormat.PlainText }
    : { insertText: insert.snippet, insertTextFormat: InsertTextFormat.Snippet };
}

/** Digits of each key of a `sortText`: fitting, group and priority, so every item's keys line up. */
const keyDigits = [1, 2, String(lowestPriority).length] as const;

/** The rank's keys, then the name. */
function sortText(rank: Rank, name: string): string {
  const keys = rankKeys(rank).map((key, index) => String(key).padStart(keyDigits[index] ?? 0, '0'));
  return `${keys.join('')}${name}`;
}
