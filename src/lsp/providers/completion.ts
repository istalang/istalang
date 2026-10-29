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
  type Rank,
  rankGroups,
} from '../../language-service/completion/item.ts';
import { completionTriggers } from '../../language-service/completion/triggers.ts';
import { documentOffset } from '../locations.ts';
import type { Provider } from './provider.ts';

export const completion: Provider = {
  capabilities: { completionProvider: { triggerCharacters: [...completionTriggers] } },
  register: (connection, workspace) => {
    connection.onCompletion((params) => {
      const at = documentOffset(workspace, params);
      return at === undefined
        ? []
        : completionsAt(
            workspace.program,
            at.module,
            at.offset,
            params.context?.triggerCharacter,
          ).map(completionItem);
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

/** Digits of each numeric part of a `sortText`, so every item's parts line up. */
const groupDigits = 2;
const priorityDigits = 3;

/** Fitting items first, then by group, priority and name. */
function sortText({ fitsExpected, group, priority = 0 }: Rank, name: string): string {
  const groupIndex = group === undefined ? 0 : rankGroups.indexOf(group);
  const groupPart = String(groupIndex).padStart(groupDigits, '0');
  const priorityPart = String(priority).padStart(priorityDigits, '0');
  return `${fitsExpected ? 0 : 1}${groupPart}${priorityPart}${name}`;
}
