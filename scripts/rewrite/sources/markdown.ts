/**
 * The Istalang sources of the spec and the guide: their fenced examples, read from the text in hand
 * by the extractor the spec-example tests read them with (test/corpus/spec-examples.ts), so the
 * rewriter reaches exactly the code those tests check, by the one rule that finds it.
 *
 * Each code line maps to where the extractor found it in the document. A line break an edit writes
 * takes the fence's indentation, so new lines stay inside the fence.
 */

import {
  documentPaths,
  extractExamples,
  type SpecExample,
} from '../../../test/corpus/spec-examples.ts';
import { type Embed, type Embedding, embeddingOf } from '../embedding.ts';

/** The examples `contents` holds, when `path` is one of the documents holding examples. */
export const embedMarkdown: Embed = (path, contents) => {
  const document = documentPaths.find((candidate) => candidate === path);
  return {
    embeddings:
      document === undefined ? [] : extractExamples(document, contents).map(exampleEmbedding),
    skipped: [],
  };
};

function exampleEmbedding({ code, codeStarts, indentation }: SpecExample): Embedding {
  const offsets = code
    .split('\n')
    .flatMap((line, index) =>
      Array.from({ length: line.length + 1 }, (_, column) => (codeStarts[index] ?? 0) + column),
    );
  const spell = (text: string): string => text.replaceAll('\n', `\n${indentation}`);
  return embeddingOf(offsets[0] ?? 0, [{ kind: 'spelled', text: code, offsets, spell }]);
}
