/**
 * The references of every declaration over the corpus and std modules, through the protocol: the
 * names going to a definition lands on it, the declaration itself included or left out.
 *
 * Requests go one document at a time: the client's writer queues every request not sent yet, at a
 * cost growing with the queue, so asking for every name at once spends more on queueing than on
 * answering.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Location } from 'vscode-languageserver/node';
import type { StringLiteral } from '../../../../compiler/syntax/expressions/literals/literals.ts';
import type { SyntaxTree } from '../../../../compiler/syntax/tree/index.ts';
import type { Identifier } from '../../../../compiler/syntax/tree/node.ts';
import { spanIn } from '../../../../compiler/syntax/tree/positions.ts';
import { addToGroup } from '../../../../foundation/structures/groups.ts';
import { corpusClient, corpusDocuments, type OpenDocument } from '../../corpus-client.test-kit.ts';
import type { TestClient } from '../../server.test-kit.ts';
import {
  definitionsAt,
  namesOf,
  placeOf,
  positionOf,
  referencesAt,
} from './navigation.test-kit.ts';

let client: TestClient;

beforeAll(async () => {
  client = await corpusClient();
});

/** Where `name` stands in the document `uri` holding `tree`. */
function locationOf(uri: string, tree: SyntaxTree, name: Identifier | StringLiteral): Location {
  const { start, end } = spanIn(tree, name.span);
  return {
    uri,
    range: { start: positionOf(tree.source, start), end: positionOf(tree.source, end) },
  };
}

/** Each name of `document` with the declarations going to its definition lands on. */
async function landingsIn({ uri, tree }: OpenDocument) {
  const landings = await Promise.all(
    namesOf(tree).map(async (name) => {
      const location = locationOf(uri, tree, name);
      const declarations = await definitionsAt(client, uri, location.range.start);
      return declarations.map((declaration) => ({ declaration, use: placeOf(location) }));
    }),
  );
  return landings.flat();
}

/**
 * Every name of every document, by the place of each declaration going to its definition lands on.
 */
async function namesByDeclaration(): Promise<ReadonlyMap<string, readonly string[]>> {
  const byDeclaration = new Map<string, string[]>();
  for (const document of corpusDocuments) {
    for (const { declaration, use } of await landingsIn(document)) {
      addToGroup(byDeclaration, placeOf(declaration), use);
    }
  }
  return byDeclaration;
}

/** Whether `places` holds each of `expected` once, and nothing else. */
function isSetOf(places: readonly string[], expected: ReadonlySet<string>): boolean {
  return places.length === expected.size && places.every((place) => expected.has(place));
}

/** The declarations of `document` whose references aren't the names `byDeclaration` gives them. */
async function mismatchesIn(
  { uri, tree }: OpenDocument,
  byDeclaration: ReadonlyMap<string, readonly string[]>,
): Promise<readonly string[]> {
  const wrong = await Promise.all(
    namesOf(tree).map(async (name) => {
      const location = locationOf(uri, tree, name);
      const declaration = placeOf(location);
      const names = byDeclaration.get(declaration);
      if (names === undefined) {
        return [];
      }
      const all = (await referencesAt(client, location, true)).map(placeOf);
      const uses = (await referencesAt(client, location, false)).map(placeOf);
      const expected = new Set(names);
      const expectedUses = new Set(names.filter((each) => each !== declaration));
      return isSetOf(all, expected) && isSetOf(uses, expectedUses) ? [] : [declaration];
    }),
  );
  return wrong.flat();
}

describe('the references of a declaration', () => {
  it('are the names whose definition is it, in every module', async () => {
    const byDeclaration = await namesByDeclaration();
    const mismatched: string[] = [];
    for (const document of corpusDocuments) {
      // biome-ignore lint/performance/noAwaitInLoops: one document's requests at a time (the banner).
      mismatched.push(...(await mismatchesIn(document, byDeclaration)));
    }
    expect(mismatched).toEqual([]);
  }, 120_000);
});
