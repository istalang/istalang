/**
 * The VS Code grammar is JSON that VS Code loads as is, so it cannot import the scanner's word
 * list. It spells the reserved words out instead, grouped by highlighting scope, and this test
 * holds that copy to the scanner's: a keyword added to the language fails here until it is
 * highlighted.
 */

import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { keywords } from '../src/compiler/syntax/tokens.ts';

const grammarShape = z.object({
  repository: z.object({
    keyword: z.object({ patterns: z.array(z.object({ match: z.string() })) }),
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
