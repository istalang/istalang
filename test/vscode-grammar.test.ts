/**
 * The VS Code grammar is JSON that VS Code loads as is, so it cannot import the scanner's word
 * list, the heads' modifiers or the language's primitive types. It spells them out instead, the
 * reserved words grouped by highlighting scope, and this test holds those copies to the
 * originals: a keyword, a modifier or a primitive added to the language fails here until it is
 * highlighted.
 */

import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { isKeyword, keywords } from '../src/compiler/syntax/tokens/index.ts';
import { headForms, modifierGroups } from '../src/compiler/syntax/tokens/modifiers.ts';
import { primitiveNames } from '../src/foundation/language/primitives.ts';

const grammarShape = z.object({
  repository: z.object({
    modifier: z.object({ match: z.string() }),
    declaration: z.object({ patterns: z.array(z.object({ match: z.string() })) }),
    keyword: z.object({ patterns: z.array(z.object({ match: z.string() })) }),
    type: z.object({ patterns: z.array(z.object({ name: z.string(), match: z.string() })) }),
  }),
});

const grammar = grammarShape.parse(
  JSON.parse(
    readFileSync(
      new URL('../.vscode/extensions/ista/syntaxes/ista.tmLanguage.json', import.meta.url),
      'utf8',
    ),
  ),
);

/** The words of a `\b(a|b|c)\b` alternation. */
function alternationWords(pattern: string): string[] {
  return pattern.replace(/^\\b\(|\)\\b$/gu, '').split('|');
}

it('highlights exactly the reserved words', () => {
  const highlighted = grammar.repository.keyword.patterns.flatMap((p) => alternationWords(p.match));
  expect(highlighted.toSorted()).toEqual(keywords.toSorted());
});

it('highlights exactly the primitive types as primitives', () => {
  const primitives = grammar.repository.type.patterns.filter(
    ({ name }) => name === 'support.type.primitive.ista',
  );
  expect(primitives.flatMap((p) => alternationWords(p.match)).toSorted()).toEqual(
    primitiveNames.toSorted(),
  );
});

const isContextual = (word: string) => !isKeyword(word);

/** Each form's heads with each contextual modifier first, and last after the others reversed. */
const heads = Object.values(headForms).flatMap(({ groups, keyword }) =>
  groups.flatMap((group, index) => {
    const others = groups.toSpliced(index, 1).map((other) => modifierGroups[other][0]);
    return modifierGroups[group].filter(isContextual).flatMap((word) =>
      [
        [word, ...others],
        [...others.toReversed(), word],
      ].map((modifiers) => ({
        modifiers,
        keyword,
      })),
    );
  }),
);

it("highlights a head's contextual modifiers in any order, and the same words elsewhere as names", () => {
  const modifier = new RegExp(grammar.repository.modifier.match, 'gu');
  const highlighted = (text: string) => [...text.matchAll(modifier)].map(([, word]) => word);
  for (const { modifiers, keyword } of heads) {
    expect(highlighted(`${modifiers.join(' ')} ${keyword} F`)).toEqual(
      modifiers.filter(isContextual),
    );
  }
  for (const word of new Set(heads.flatMap(({ modifiers }) => modifiers.filter(isContextual)))) {
    expect(highlighted(`${word} = ${word}.call(${word})`)).toEqual([]);
  }
  expect(highlighted('fn f(g: sendable fn(Int)) -> sendable ista async fn()')).toEqual([
    'sendable',
    'sendable',
    'ista',
  ]);
});

it("highlights `get` before a function's name as a getter's, and a function named `get` as a name", () => {
  const declares = grammar.repository.declaration.patterns.map(
    ({ match }) => new RegExp(match, 'u'),
  );
  /** The getter word and the function's name a declaration's head highlights. */
  const head = (text: string) => {
    const found = declares.map((pattern) => pattern.exec(text)).find((match) => match !== null);
    return found === undefined ? undefined : { get: found[2], name: found[5] };
  };
  expect(head('fn get full(self: Person) -> String')).toEqual({ get: 'get', name: 'full' });
  expect(head('fn get get(self: Box) -> Int')).toEqual({ get: 'get', name: 'get' });
  expect(head('fn get<K, V>(self: Map<K, V>, key: K) -> V?')).toEqual({
    get: undefined,
    name: 'get',
  });
  expect(head('fn get(self: Box) -> Int')).toEqual({ get: undefined, name: 'get' });
  expect(head('fn Box.get() -> Box')).toEqual({ get: undefined, name: 'get' });
  expect(head('fn get: get > 0')).toBeUndefined();
});
