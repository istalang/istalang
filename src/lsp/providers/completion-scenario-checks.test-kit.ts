/**
 * How a completion scenario judges the list it gets (completion-scenarios.test-kit.ts): each key
 * of what a scenario expects is a check, and a check names every problem it finds as a sentence,
 * so one run lists everything a scenario misses.
 */

import {
  type CompletionItem,
  CompletionItemKind,
  type CompletionOptions,
} from 'vscode-languageserver/node';

/** What the list must hold; every key is an independent check. */
export interface Expect {
  /** No item at all. */
  readonly none?: true;
  readonly has?: readonly string[];
  readonly lacks?: readonly string[];
  /** Exactly these labels. */
  readonly exact?: readonly string[];
  /** At least one of these labels. */
  readonly anyOf?: readonly string[];
  readonly nonEmpty?: true;
  /** The text each label's item inserts. */
  readonly insert?: readonly (readonly [label: string, text: string])[];
  /** The labels' items insert each of these texts (one item per text). */
  readonly insertTexts?: readonly (readonly [label: string, texts: readonly string[]])[];
  /** Items that ask the client to list again once accepted. */
  readonly retrigger?: readonly string[];
  /** The command an item runs once accepted. */
  readonly command?: readonly (readonly [label: string, command: string])[];
  readonly commit?: readonly (readonly [label: string, character: string])[];
  readonly kind?: readonly (readonly [label: string, kind: keyof typeof CompletionItemKind])[];
  readonly detail?: readonly (readonly [label: string, detail: string])[];
  /** Labels that must rank within the first `k` items. */
  readonly within?: { readonly labels: readonly string[]; readonly k: number };
  /** Pairs `[a, b]` where `a` must rank before `b`. */
  readonly before?: readonly (readonly [string, string])[];
  readonly preselect?: string;
  readonly anyPreselect?: true;
  readonly unique?: true;
  /** No label starts with this. */
  readonly lacksPrefix?: string;
  /** Kinds (by name) no item may have. */
  readonly lacksKinds?: readonly (keyof typeof CompletionItemKind)[];
  /** Trigger characters the server must declare. */
  readonly triggers?: readonly string[];
  /** The item of this label carries its declaration's documentation (the server resolves none). */
  readonly docs?: string;
}

type Rank = (label: string) => number;

export interface Answer {
  readonly items: readonly CompletionItem[];
  readonly labels: readonly string[];
  readonly rank: Rank;
  readonly options: CompletionOptions;
}

const insertedBy = (item: CompletionItem): string =>
  (item.textEdit && 'newText' in item.textEdit ? item.textEdit.newText : undefined) ??
  item.insertText ??
  item.label;

const itemFor = (answer: Answer, label: string) =>
  answer.items.find((item) => item.label === label);

const missing = (answer: Answer, labels: readonly string[]) =>
  labels.filter((label) => !answer.labels.includes(label)).map((label) => `missing ${label}`);

/** For each `[label, want]`, the problem a check finds in the label's item, or that it is missing. */
function perItem<W>(
  answer: Answer,
  wanted: readonly (readonly [string, W])[],
  problem: (item: CompletionItem, want: W) => string | undefined,
): string[] {
  return wanted.flatMap(([label, want]) => {
    const item = itemFor(answer, label);
    if (item === undefined) {
      return [`missing ${label}`];
    }
    const found = problem(item, want);
    return found === undefined ? [] : [found];
  });
}

export const rankIn = (items: readonly CompletionItem[]): Rank => {
  const sorted = items.toSorted(
    (a, b) =>
      Number(b.preselect ?? false) - Number(a.preselect ?? false) ||
      (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label),
  );
  return (label) => sorted.findIndex((item) => item.label === label);
};

const checks: {
  readonly [K in keyof Expect]-?: (answer: Answer, want: NonNullable<Expect[K]>) => string[];
} = {
  none: ({ labels }) =>
    labels.length === 0 ? [] : [`offered ${labels.length}: ${labels.slice(0, 5).join(', ')}…`],
  has: (answer, want) => missing(answer, want),
  lacks: ({ labels }, want) =>
    want.filter((label) => labels.includes(label)).map((label) => `unexpected ${label}`),
  exact: ({ labels }, want) =>
    JSON.stringify(labels.toSorted()) === JSON.stringify(want.toSorted())
      ? []
      : [`offered [${labels.slice(0, 8).join(', ')}], want [${want.join(', ')}]`],
  anyOf: ({ labels }, want) =>
    want.some((label) => labels.includes(label)) ? [] : [`none of ${want.join(', ')} offered`],
  nonEmpty: ({ labels }) => (labels.length > 0 ? [] : ['nothing offered']),
  insert: (answer, want) =>
    perItem(answer, want, (item, text: string) =>
      insertedBy(item) === text
        ? undefined
        : `${item.label} inserts ${JSON.stringify(insertedBy(item))}, want ${JSON.stringify(text)}`,
    ),
  insertTexts: ({ items }, want) =>
    want.flatMap(([label, texts]) => {
      const inserted = items.filter((item) => item.label === label).map(insertedBy);
      return texts
        .filter((text) => !inserted.includes(text))
        .map((text) => `no ${label} inserts ${JSON.stringify(text)}`);
    }),
  retrigger: (answer, want) =>
    want.flatMap((label) => {
      const item = itemFor(answer, label);
      return item?.command?.command === 'editor.action.triggerSuggest'
        ? []
        : [`${label} doesn't ask for a list again`];
    }),
  command: (answer, want) =>
    perItem(answer, want, (item, command: string) =>
      item.command?.command === command ? undefined : `${item.label} runs no ${command}`,
    ),
  commit: (answer, want) =>
    perItem(answer, want, (item, character: string) =>
      item.commitCharacters?.includes(character)
        ? undefined
        : `${item.label} has no commit ${character}`,
    ),
  kind: (answer, want) =>
    perItem(answer, want, (item, kind: keyof typeof CompletionItemKind) =>
      item.kind === CompletionItemKind[kind]
        ? undefined
        : `${item.label} has kind ${item.kind}, want ${kind}`,
    ),
  detail: (answer, want) =>
    perItem(answer, want, (item, detail: string) =>
      item.detail === detail
        ? undefined
        : `${item.label} detail ${JSON.stringify(item.detail)}, want ${JSON.stringify(detail)}`,
    ),
  within: ({ rank, labels }, { labels: wanted, k }) =>
    wanted.flatMap((label) => {
      if (!labels.includes(label)) {
        return [`missing ${label}`];
      }
      return rank(label) < k ? [] : [`${label} ranks ${rank(label) + 1}, not in the first ${k}`];
    }),
  before: ({ rank, labels }, want) =>
    want.flatMap(([first, second]) =>
      labels.includes(first) && labels.includes(second) && rank(first) > rank(second)
        ? [`${first} ranks after ${second}`]
        : [],
    ),
  preselect: ({ items }, want) => {
    const chosen = items.find((item) => item.preselect)?.label;
    return chosen === want ? [] : [`preselected ${chosen}, want ${want}`];
  },
  anyPreselect: ({ items }) =>
    items.some((item) => item.preselect) ? [] : ['nothing preselected'],
  unique: ({ labels }) => {
    const repeated = labels.filter((label, index) => labels.indexOf(label) !== index);
    return repeated.length === 0 ? [] : [`repeated ${[...new Set(repeated)].join(', ')}`];
  },
  lacksPrefix: ({ labels }, want) =>
    labels.filter((label) => label.startsWith(want)).map((label) => `unexpected ${label}`),
  lacksKinds: ({ items }, want) =>
    want.flatMap((kind) =>
      items.some((item) => item.kind === CompletionItemKind[kind]) ? [`${kind} items offered`] : [],
    ),
  triggers: ({ options }, want) =>
    want
      .filter((character) => !options.triggerCharacters?.includes(character))
      .map((character) => `trigger ${JSON.stringify(character)} not declared`),
  docs: ({ items }, want: string) =>
    items.find(({ label }) => label === want)?.documentation === undefined
      ? [`${want} carries no documentation`]
      : [],
};

export function problemsOf(answer: Answer, expected: Expect): string[] {
  return Object.entries(expected).flatMap(([key, want]) =>
    (checks[key as keyof Expect] as (answer: Answer, want: unknown) => string[])(answer, want),
  );
}
