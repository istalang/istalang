/**
 * The completion scenario catalogue (docs/work/completion/scenarios.md) as tests: one `it` per
 * scenario, named `<ID> <title>` so `vitest -t "TL-01 "` runs one. A scenario is data: a snippet
 * with the cursor marked `‸`, the request that asks for the list, what the list must hold, and the
 * place the service reads at the cursor (language-service/completion/place.ts), tested apart as
 * `<ID> place` so a provider's gap and a misread place never look alike.
 *
 * Scenarios the server does not meet yet are pinned with `it.fails`: such a test passes while the
 * scenario fails and fails when it starts to hold, which is the moment to drop its `fails` flag.
 *
 * Every request opens a document of its own, the catalogue's fixture module followed by the
 * snippet, and the answer is judged as the editor would see it (completion-scenario-checks
 * .test-kit.ts), with the trigger characters the server declared, since the client never sends
 * one that was not.
 */

import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type CompletionItem,
  type CompletionOptions,
  CompletionRequest,
  CompletionTriggerKind,
} from 'vscode-languageserver/node';
import { corpusDirectory } from '../../../test/corpus/programs.ts';
import { checkedModule } from '../../language-service/checked-module.ts';
import { cursorAt } from '../../language-service/completion/cursor.ts';
import { type PlaceKind, placeAt } from '../../language-service/completion/place.ts';
import { mainProgram } from '../../language-service/language-service.test-kit.ts';
import { connectedClient, type TestClient } from '../server.test-kit.ts';
import {
  type Answer,
  type Expect,
  problemsOf,
  rankIn,
} from './completion-scenario-checks.test-kit.ts';

const cursor = '‸';

const fixture = `import * as time from 'time'

struct Pair:
  first: Int
  second: Int

struct UserId { id: String }

shared struct Lease:
  name: String
  renewals: Int = 0

enum Color { Red; Green; Blue }

enum Decision:
  Approved { by: String }
  Rejected { by: String; reason: String }
  Expired

struct Cfg:
  color: Color
  n: Int
  note: String?

struct Box<T>:
  value: T
  tag: String

trait Shape:
  fn area(self: Self) -> Float

trait Zero:
  fn Self.zero() -> Self

fn plus(a: Int, b = 1): a + b
fn paint(c: Color, n: Int) -> Int: n
fn Pair.make() -> Pair: Pair{first: 1, second: 2}
fn sum(self: Pair) -> Int: self.first + self.second
async fn fetch(id: String) -> Future<String>: id
async fn work(n: Int) -> Future<Int>: n
fn logAll(level: String, ...parts: Array<String>): 1
fn _hidden() -> Int: 1
type Id = String
struct Opts { zeta: Int; alpha: Int = 1 }

`;

const header =
  'fn t(xs: Array<Int>, p: Pair, po: Pair?, cfg: Cfg, d: Decision, o: Int?, l: Lease, u: UserId, m: Map<String, Int>, n: Int, col: Color, r: Result<Int>) -> Int:\n';

type Variant = string | { readonly src: string; readonly trigger?: string };

export interface Scenario {
  readonly id: string;
  readonly title: string;
  /** The place the service reads at the cursor: one for every variant, or one per variant. */
  readonly place: PlaceKind | readonly PlaceKind[];
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

/**
 * Opens `text` as a document of its own, asks for the list at its `‸` as the editor would, closes
 * it. A typed character the server didn't declare asks nothing, so it opens no list.
 */
async function completeAt(
  client: TestClient,
  snippet: string,
  trigger: string | undefined,
): Promise<Answer> {
  const options = client.initialized.capabilities.completionProvider ?? {};
  const items = asks(options, trigger) ? await requestAt(client, snippet, trigger) : [];
  return { items, labels: items.map(({ label }) => label), rank: rankIn(items), options };
}

/** Whether typing `trigger` asks for a list; invoking always does. */
function asks(options: CompletionOptions, trigger: string | undefined): boolean {
  return trigger === undefined || (options.triggerCharacters?.includes(trigger) ?? false);
}

async function requestAt(
  client: TestClient,
  snippet: string,
  trigger: string | undefined,
): Promise<readonly CompletionItem[]> {
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
  return Array.isArray(reply) ? reply : (reply?.items ?? []);
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

function variantOf(
  scenario: Scenario,
  variant: Variant,
): { readonly src: string; readonly trigger: string | undefined } {
  return typeof variant === 'string'
    ? { src: variant, trigger: scenario.trigger }
    : { src: variant.src, trigger: variant.trigger };
}

/** The place the service reads at each variant's cursor, the document parsed and checked alone. */
function placesOf(scenario: Scenario): readonly PlaceKind[] {
  return scenario.src.map((variant) => {
    const { src, trigger } = variantOf(scenario, variant);
    const document = documentOf(scenario, src);
    const at = document.indexOf(cursor);
    const { program, module } = mainProgram(document.slice(0, at) + document.slice(at + 1));
    const checked = checkedModule(program, module);
    if (checked === undefined) {
      throw new Error(`${scenario.id}: the program holds no main module`);
    }
    return placeAt(cursorAt(checked, at, trigger, [])).kind;
  });
}

/** The problems a scenario finds in the lists its snippets get; empty when it holds. */
async function problemsIn(client: TestClient, scenario: Scenario): Promise<string[]> {
  const answers = await Promise.all(
    scenario.src.map(async (variant) => {
      const { src, trigger } = variantOf(scenario, variant);
      const answer = await completeAt(client, documentOf(scenario, src), trigger);
      const problems = problemsOf(answer, scenario.expect);
      const refused =
        problems.length > 0 && !asks(answer.options, trigger)
          ? [`${JSON.stringify(trigger)} is not a trigger character`]
          : [];
      return { answer, problems: [...refused, ...problems] };
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

/**
 * Two tests per scenario: its list, pinned with `it.fails` where the scenario is marked as not met
 * yet, and the place the service reads at its cursor.
 */
export function describeScenarios(name: string, scenarios: readonly Scenario[]): void {
  const client = completionClient();
  describe(name, () => {
    for (const scenario of scenarios) {
      const title = `${scenario.id} ${scenario.title}`;
      const problems = () => problemsIn(client(), scenario);
      const { place } = scenario;
      it(`${scenario.id} place`, () => {
        const expected = typeof place === 'string' ? scenario.src.map(() => place) : place;
        expect(placesOf(scenario)).toEqual(expected);
      });
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
