import { beforeAll, describe, expect, it } from 'vitest';
import { wholeProgramTimeout } from '../../../../compiler/compile.test-kit.ts';
import { spanIn } from '../../../../compiler/syntax/tree/positions.ts';
import { nameAt } from '../../../language-service/navigation/declarations.ts';
import { corpusClient, corpusDocuments, corpusProgram } from '../../corpus-client.test-kit.ts';
import { locationOf, moduleIdOfUri } from '../../locations.ts';
import type { TestClient } from '../../server.test-kit.ts';
import { definitionsAt, namesOf, placeOf, positionOf } from './navigation.test-kit.ts';

let client: TestClient;

beforeAll(async () => {
  client = await corpusClient();
}, wholeProgramTimeout);

describe('going to a definition', () => {
  it.each(corpusDocuments)(
    'lands on the name declaring what each name denotes: $uri',
    async ({ uri, tree }) => {
      const module = moduleIdOfUri(uri);
      const names = namesOf(tree);
      const landed = await Promise.all(
        names.map((name) =>
          definitionsAt(client, uri, positionOf(tree.source, spanIn(tree, name.span).start)),
        ),
      );
      const denoted = names.map((name) =>
        (nameAt(corpusProgram, module, spanIn(tree, name.span).start)?.declarations ?? []).map(
          ({ at }) => placeOf(locationOf(corpusProgram, at.module, at.name.span)),
        ),
      );
      expect(landed.map((locations) => locations.map(placeOf))).toEqual(denoted);
      const targets = [...new Map(landed.flat().map((each) => [placeOf(each), each])).values()];
      const again = await Promise.all(
        targets.map((target) => definitionsAt(client, target.uri, target.range.start)),
      );
      const notDeclaring = targets.filter(
        (target, index) => !again[index]?.some((each) => placeOf(each) === placeOf(target)),
      );
      expect(notDeclaring.map(placeOf)).toEqual([]);
    },
  );

  it('answers nothing in a document the server has no text of', async () => {
    const position = { line: 0, character: 0 };
    expect(await definitionsAt(client, 'file:///nowhere/unopened.ista', position)).toEqual([]);
  });
});
