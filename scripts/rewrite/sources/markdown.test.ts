/**
 * The documents' examples as sources: each is the code the spec-example tests read, every boundary
 * of it maps to where that code stands in the text given, and a line an edit adds stays in its fence.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { documentPaths, specExamples } from '../../../test/corpus/spec-examples.ts';
import { applyEdits } from '../edits.ts';
import { type Embedding, fileEditOf } from '../embedding.ts';
import { embedMarkdown } from './markdown.ts';

const root = new URL('../../../', import.meta.url);

const documents = documentPaths.map((path) => {
  const contents = readFileSync(new URL(path, root), 'utf8');
  return { path, contents, embeddings: embedMarkdown(path, contents).embeddings };
});

/** A guide whose one example sits in a fence indented by a list item. */
const listed = [
  '# Steps',
  '',
  '1. Defer it:',
  '',
  '   ```ista statements',
  '   defer fn(): log("exited")',
  '',
  '   x = 1',
  '   ```',
  '',
].join('\n');

/** The one example `contents` holds, as the guide; throws unless it holds one. */
function soleExampleOf(contents: string): Embedding {
  const [embedding, ...others] = embedMarkdown('docs/guide.md', contents).embeddings;
  if (embedding === undefined || others.length > 0) {
    throw new Error('The text holds no one example.');
  }
  return embedding;
}

/** `contents` with `edit` of its sole example made in it. */
function edited(contents: string, edit: Parameters<typeof fileEditOf>[1]): string {
  const made = fileEditOf(soleExampleOf(contents), edit);
  if ('refusal' in made) {
    throw new Error(made.refusal);
  }
  return applyEdits(contents, [made]);
}

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

  it('reads the text it is given, whatever the document on disk holds', () => {
    expect(soleExampleOf(listed).text).toBe('defer fn(): log("exited")\n\nx = 1');
    expect(embedMarkdown('README.md', listed).embeddings).toEqual([]);
  });

  it("indents a line an edit adds as its example's fence", () => {
    const start = 'defer fn(): log("exited")\n\n'.length;
    expect(edited(listed, { span: { start, end: start }, text: 'y = 2\n' })).toBe(
      listed.replace('   x = 1', '   y = 2\n   x = 1'),
    );
  });

  it('maps an edit past a blank line shorter than the fence', () => {
    const start = 'defer fn(): log("exited")\n\nx'.length;
    expect(edited(listed, { span: { start, end: start + ' = 1'.length }, text: '' })).toBe(
      listed.replace('   x = 1', '   x'),
    );
  });
});
