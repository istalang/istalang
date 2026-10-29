/**
 * The completion scenario catalogue (docs/work/completion/scenarios.md) as tests: one `it` per
 * scenario, named `<ID> <title>` so `vitest -t "TL-01 "` runs one. A scenario is data: a snippet
 * with the cursor marked `‸`, the request that asks for the list, and what the list must hold.
 *
 * Scenarios the server does not meet yet are pinned with `it.fails`: such a test passes while the
 * scenario fails and fails when it starts to hold, which is the moment to drop its `fails` flag.
 *
 * Every request opens a document of its own, the catalogue's fixture module followed by the
 * snippet, and the answer is judged as the editor would see it: labels, the text an item inserts
 * (`textEdit`, else `insertText`, else the label), its command, kind, detail and sort order
 * (`preselect` first, then `sortText`, else the label), and the trigger characters the server
 * declared, since the client never sends one that was not. Failures are collected as sentences
 * so one run names everything a scenario misses.
 */

import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type CompletionItem,
  CompletionItemKind,
  type CompletionOptions,
  CompletionRequest,
  CompletionTriggerKind,
} from 'vscode-languageserver/node';
import { corpusDirectory } from '../../../test/corpus/programs.ts';
import { connectedClient, type TestClient } from '../server.test-kit.ts';

const cursor = '‸';

const fixture = `import * as time from 'time'

struct Pair:
  first: int
  second: int

struct UserId { id: string }

shared struct Lease:
  name: string
  renewals: int = 0

enum Color { Red; Green; Blue }

enum Decision:
  Approved { by: string }
  Rejected { by: string; reason: string }
  Expired

struct Cfg:
  color: Color
  n: int
  note: string?

struct Box<T>:
  value: T
  tag: string

trait Shape:
  fn area(self: Self) -> float

trait Zero:
  fn Self.zero() -> Self

fn plus(a: int, b = 1): a + b
fn paint(c: Color, n: int) -> int: n
fn Pair.make() -> Pair: Pair{first: 1, second: 2}
fn sum(self: Pair) -> int: self.first + self.second
async fn fetch(id: string) -> Future<string>: id
async fn work(n: int) -> Future<int>: n
fn logAll(level: string, ...parts: Array<string>): 1
fn _hidden() -> int: 1
type Id = string
struct Opts { zeta: int; alpha: int = 1 }

`;

const header =
  'fn t(xs: Array<int>, p: Pair, po: Pair?, cfg: Cfg, d: Decision, o: int?, l: Lease, u: UserId, m: Map<string, int>, n: int, col: Color, r: Result<int>) -> int:\n';

/** What the list must hold; every key is an independent check. */
interface Expect {
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
  /** Items carry documentation, or the server resolves it. */
  readonly docs?: true;
}

type Variant = string | { readonly src: string; readonly trigger?: string };

export interface Scenario {
  readonly id: string;
  readonly title: string;
  /** Snippets, each with the cursor; every one must meet `expect`. */
  readonly src: readonly Variant[];
  /** The character whose typing asks for the list; absent: invoked. */
  readonly trigger?: string;
  /** Where the snippet stands: the fixture's end (`top`), `fn t`'s body, `async fn t`'s, or alone. */
  readonly where?: 'top' | 'async' | 'empty';
  /** Text after the cursor's line; the default keeps a body's block from being empty. */
  readonly tail?: string;
  readonly crlf?: true;
  /** The variants must offer the same labels. */
  readonly same?: true;
  readonly expect: Expect;
  /** The server does not meet it yet. */
  readonly fails?: true;
}

type Rank = (label: string) => number;

interface Answer {
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

const rankIn = (items: readonly CompletionItem[]): Rank => {
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
  docs: ({ items, options }) =>
    options.resolveProvider || items.some((item) => item.documentation) ? [] : ['no documentation'],
};

function problemsOf(answer: Answer, expected: Expect): string[] {
  return Object.entries(expected).flatMap(([key, want]) =>
    (checks[key as keyof Expect] as (answer: Answer, want: unknown) => string[])(answer, want),
  );
}

/** A client of a server for the corpus project, shared by the scenarios of one file. */
export function completionClient(): () => TestClient {
  let client: TestClient | undefined;
  beforeAll(async () => {
    client = await connectedClient(corpusDirectory);
  });
  return () => {
    if (client === undefined) {
      throw new Error('the client starts before the tests');
    }
    return client;
  };
}

let documents = 0;

/** Opens `text` as a document of its own, asks for the list at its `‸`, closes it. */
async function completeAt(
  client: TestClient,
  snippet: string,
  trigger: string | undefined,
): Promise<Answer> {
  const at = snippet.indexOf(cursor);
  const text = snippet.slice(0, at) + snippet.slice(at + 1);
  const lines = text.slice(0, at).split('\n');
  documents += 1;
  const uri = pathToFileURL(`${corpusDirectory}completion-scenario-${documents}.ista`).href;
  await client.open(uri, text);
  const reply = await client.connection.sendRequest(CompletionRequest.type, {
    textDocument: { uri },
    position: { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 },
    context:
      trigger === undefined
        ? { triggerKind: CompletionTriggerKind.Invoked }
        : { triggerKind: CompletionTriggerKind.TriggerCharacter, triggerCharacter: trigger },
  });
  await client.close(uri);
  const items = Array.isArray(reply) ? reply : (reply?.items ?? []);
  return {
    items,
    labels: items.map(({ label }) => label),
    rank: rankIn(items),
    options: client.initialized.capabilities.completionProvider ?? {},
  };
}

function opening(where: Scenario['where']): string {
  if (where === 'empty') {
    return '';
  }
  if (where === 'top') {
    return fixture;
  }
  return fixture + (where === 'async' ? header.replace('fn t', 'async fn t') : header);
}

function documentOf(scenario: Scenario, src: string): string {
  const bodyHolds = scenario.where === undefined || scenario.where === 'async';
  const text = opening(scenario.where) + src + (scenario.tail ?? (bodyHolds ? '\n  0\n' : ''));
  return scenario.crlf ? text.replaceAll('\n', '\r\n') : text;
}

/** The problems a scenario finds in the lists its snippets get; empty when it holds. */
async function problemsIn(client: TestClient, scenario: Scenario): Promise<string[]> {
  const answers = await Promise.all(
    scenario.src.map(async (variant) => {
      const { src, trigger } =
        typeof variant === 'string' ? { src: variant, trigger: scenario.trigger } : variant;
      const answer = await completeAt(client, documentOf(scenario, src), trigger);
      const refused =
        trigger !== undefined && !answer.options.triggerCharacters?.includes(trigger)
          ? [`${JSON.stringify(trigger)} is not a trigger character`]
          : [];
      return { answer, problems: [...refused, ...problemsOf(answer, scenario.expect)] };
    }),
  );
  const labelSets = answers.map(({ answer }) => JSON.stringify(answer.labels.toSorted()));
  const differing =
    scenario.same && new Set(labelSets).size > 1 ? ["the variants' lists differ"] : [];
  return [
    ...answers.flatMap(({ problems }, index) =>
      problems.map((each) => (answers.length > 1 ? `#${index + 1} ${each}` : each)),
    ),
    ...differing,
  ];
}

/** One test per scenario, pinned with `it.fails` where the scenario is marked as not met yet. */
export function describeScenarios(name: string, scenarios: readonly Scenario[]): void {
  const client = completionClient();
  describe(name, () => {
    for (const scenario of scenarios) {
      const title = `${scenario.id} ${scenario.title}`;
      const problems = () => problemsIn(client(), scenario);
      if (scenario.fails) {
        it.fails(title, async () => {
          expect(await problems()).toEqual([]);
        });
      } else {
        it(title, async () => {
          expect(await problems()).toEqual([]);
        });
      }
    }
  });
}
