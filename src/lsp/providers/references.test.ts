import { beforeAll, describe, expect, it } from 'vitest';
import type { Location } from 'vscode-languageserver/node';
import { spanIn } from '../../compiler/syntax/positions.ts';
import { corpusClient, corpusDocuments } from '../corpus-client.test-kit.ts';
import type { TestClient } from '../server.test-kit.ts';
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

/** Every name of every document, by the place of each declaration going to its definition lands on. */
async function namesByDeclaration(): Promise<ReadonlyMap<string, readonly string[]>> {
  const landings = await Promise.all(
    corpusDocuments.flatMap(({ uri, tree }) =>
      namesOf(tree).map(async (name) => {
        const range = {
          start: positionOf(tree.source, spanIn(tree, name.span).start),
          end: positionOf(tree.source, spanIn(tree, name.span).end),
        };
        const declarations = await definitionsAt(client, uri, range.start);
        return declarations.map((declaration) => ({ declaration, use: placeOf({ uri, range }) }));
      }),
    ),
  );
  const byDeclaration = new Map<string, string[]>();
  for (const { declaration, use } of landings.flat()) {
    const key = placeOf(declaration);
    byDeclaration.set(key, [...(byDeclaration.get(key) ?? []), use]);
  }
  return byDeclaration;
}

/** Whether `places` holds each of `expected` once, and nothing else. */
function isSetOf(places: readonly string[], expected: ReadonlySet<string>): boolean {
  return places.length === expected.size && places.every((place) => expected.has(place));
}

describe('the references of a declaration', () => {
  it('are the names whose definition is it, in every module', async () => {
    const byDeclaration = await namesByDeclaration();
    const declarations = [...byDeclaration.keys()];
    const locations = new Map(
      corpusDocuments.flatMap(({ uri, tree }) =>
        namesOf(tree).map((name) => {
          const location: Location = {
            uri,
            range: {
              start: positionOf(tree.source, spanIn(tree, name.span).start),
              end: positionOf(tree.source, spanIn(tree, name.span).end),
            },
          };
          return [placeOf(location), location] as const;
        }),
      ),
    );
    const mismatched = await Promise.all(
      declarations.map(async (declaration) => {
        const location = locations.get(declaration);
        if (location === undefined) {
          return [];
        }
        const all = (await referencesAt(client, location, true)).map(placeOf);
        const uses = (await referencesAt(client, location, false)).map(placeOf);
        const expected = new Set(byDeclaration.get(declaration));
        const expectedUses = new Set([...expected].filter((each) => each !== declaration));
        return isSetOf(all, expected) && isSetOf(uses, expectedUses) ? [] : [declaration];
      }),
    );
    expect(mismatched.flat()).toEqual([]);
  }, 120_000);
});
