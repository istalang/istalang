/**
 * The documents' examples as sources: each is the code the spec-example tests read, every boundary
 * of it maps to where that code stands in its document, and a line an edit adds stays in its fence.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { specExamples } from '../../../test/corpus/spec-examples.ts';
import { applyEdits } from '../edits.ts';
import { fileEditOf } from '../embedding.ts';
import { embedMarkdown, exampleDocuments } from './markdown.ts';

const root = new URL('../../../', import.meta.url);

const documents = exampleDocuments.map((path) => {
  const contents = readFileSync(new URL(path, root), 'utf8');
  return { path, contents, embeddings: embedMarkdown(path, contents).embeddings };
});

describe('embedMarkdown', () => {
  it('reads each example as the code the spec-example tests check', () => {
    expect(documents.flatMap(({ embeddings }) => embeddings.map(({ text }) => text))).toEqual(
      specExamples.map(({ code }) => code),
    );
  });

  it('maps each character of an example to the same character of its document', () => {
    for (const { contents, embeddings } of documents) {
      for (const { text, spellings } of embeddings) {
        const offsets = spellings[0]?.offsets ?? [];
        const mapped = Array.from({ length: text.length }, (_, index) =>
          text[index] === '\n' ? '\n' : contents[offsets[index] ?? -1],
        );
        expect(mapped.join('')).toBe(text);
      }
    }
  });

  it("indents a line an edit adds as its example's fence", () => {
    const [indented] = documents.flatMap((document) =>
      document.embeddings
        .filter(({ at }) => document.contents[at - 1] === ' ')
        .map((example) => ({ contents: document.contents, embedding: example })),
    );
    if (indented === undefined) {
      throw new Error('No example is indented.');
    }
    const { contents, embedding } = indented;
    const edit = fileEditOf(embedding, { span: { start: 0, end: 0 }, text: 'added\n' });
    const edited = 'refusal' in edit ? contents : applyEdits(contents, [edit]);
    const lineStart = contents.lastIndexOf('\n', embedding.at) + 1;
    const fence = contents.slice(lineStart, embedding.at);
    const [firstLine] = embedding.text.split('\n');
    const expected = `${fence}added\n${fence}${firstLine}`;
    expect(fence).not.toBe('');
    expect(edited.slice(lineStart, lineStart + expected.length)).toBe(expected);
  });
});
