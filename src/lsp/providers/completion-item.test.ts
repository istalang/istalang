/**
 * The item model as the protocol's items: a rank orders a list the way the client sorts it, by
 * `sortText`, and what an item inserts or runs once accepted is said in the protocol's terms.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CompletionItemKind, InsertTextFormat, MarkupKind } from 'vscode-languageserver/node';
import { type Completion, type Rank, rankGroups } from '../../language-service/completion/item.ts';
import { completionItem } from './completion.ts';

const ranked = fc.record({
  name: fc.string({ minLength: 1, maxLength: 6 }),
  rank: fc.record(
    {
      fitsExpected: fc.boolean(),
      group: fc.constantFrom(...rankGroups),
      priority: fc.integer({ min: 0, max: 999 }),
      order: fc.integer({ min: 0, max: 999 }),
    },
    { requiredKeys: ['fitsExpected'] },
  ),
});

/** The order a rank promises: fitting items first, then by group, priority, order and name. */
function byRank(a: { name: string; rank: Rank }, b: { name: string; rank: Rank }): number {
  const groupOf = ({ group }: Rank) => (group === undefined ? 0 : rankGroups.indexOf(group));
  return (
    Number(b.rank.fitsExpected) - Number(a.rank.fitsExpected) ||
    groupOf(a.rank) - groupOf(b.rank) ||
    (a.rank.priority ?? 0) - (b.rank.priority ?? 0) ||
    (a.rank.order ?? 0) - (b.rank.order ?? 0) ||
    (a.name < b.name ? -1 : Number(a.name > b.name))
  );
}

describe('completion items', () => {
  it('sort by sortText in the order their ranks promise', () => {
    fc.assert(
      fc.property(fc.array(ranked, { maxLength: 12 }), (offered) => {
        const items = offered.map((each) => ({
          ...each,
          sortText: completionItem({ ...each, kind: 'variable' }).sortText ?? '',
        }));
        const bySortText = items.toSorted((a, b) =>
          a.sortText < b.sortText ? -1 : Number(a.sortText > b.sortText),
        );
        expect(bySortText.map(({ name, rank }) => ({ name, rank }))).toEqual(
          offered.toSorted(byRank),
        );
      }),
    );
  });

  it('insert text or a snippet, run what follows, and keep a preselection and its docs', () => {
    const field: Completion = {
      name: 'first',
      kind: 'field',
      documentation: 'The first.',
      insert: { kind: 'text', text: 'first: ' },
      next: 'completion',
      preselect: true,
      commit: [],
    };
    expect(completionItem(field)).toEqual({
      label: 'first',
      kind: CompletionItemKind.Field,
      documentation: { kind: MarkupKind.Markdown, value: 'The first.' },
      insertText: 'first: ',
      insertTextFormat: InsertTextFormat.PlainText,
      command: { title: 'Complete', command: 'editor.action.triggerSuggest' },
      preselect: true,
      commitCharacters: [],
    });
    const call: Completion = {
      name: 'plus',
      kind: 'function',
      detail: 'fn plus(a: Int, b = 1) -> Int',
      insert: { kind: 'snippet', snippet: 'plus($0)' },
      next: 'signatureHelp',
    };
    expect(completionItem(call)).toEqual({
      label: 'plus',
      kind: CompletionItemKind.Function,
      detail: 'fn plus(a: Int, b = 1) -> Int',
      insertText: 'plus($0)',
      insertTextFormat: InsertTextFormat.Snippet,
      command: { title: 'Signature help', command: 'editor.action.triggerParameterHints' },
    });
  });

  it('carry nothing but the label and kind when the model says nothing more', () => {
    expect(completionItem({ name: 'while', kind: 'keyword' })).toEqual({
      label: 'while',
      kind: CompletionItemKind.Keyword,
    });
  });
});
