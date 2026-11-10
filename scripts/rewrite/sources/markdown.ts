/**
 * The Istalang sources of the spec and the guide: their fenced examples, as the spec-example tests
 * read them (test/corpus/spec-examples.ts), so the rewriter reaches exactly the code those tests
 * check, by the one rule that finds it.
 *
 * That module reads the documents when it loads and records where each example's code starts, not
 * how deeply its fence is indented, so each code line is found again in `contents` as the end of
 * its document line, and a document that no longer holds an example's code where it was read
 * throws. A line break an edit writes takes the fence's indentation, so new lines stay inside it.
 */

import { LineMap } from '../../../src/foundation/text/line-map.ts';
import { type SpecExample, specExamples } from '../../../test/corpus/spec-examples.ts';
import { type Embed, type Embedding, embeddingOf } from '../embedding.ts';

/** The documents the examples come from, relative to the repository's root. */
export const exampleDocuments: readonly string[] = [
  ...new Set(specExamples.map(({ document }) => document)),
];

export const embedMarkdown: Embed = (path, contents) => {
  const lineMap = new LineMap(contents);
  return {
    embeddings: specExamples
      .filter(({ document }) => document === path)
      .map((example) => exampleEmbedding(example, contents, lineMap)),
    skipped: [],
  };
};

function exampleEmbedding(example: SpecExample, contents: string, lineMap: LineMap): Embedding {
  const lines = example.code.split('\n').map((code, index) => {
    const line = lineMap.lineSpan(example.line - 1 + index);
    const start = line.end - code.length;
    if (start < line.start || contents.slice(start, line.end) !== code) {
      throw new Error(`${example.document}:${example.line + index}: no longer the example read`);
    }
    return { code, start, indentation: contents.slice(line.start, start) };
  });
  const fence = lines.reduce(
    (deepest, { indentation }) => (indentation.length > deepest.length ? indentation : deepest),
    '',
  );
  const offsets = lines.flatMap(({ code, start }) =>
    Array.from({ length: code.length + 1 }, (_, column) => start + column),
  );
  const spell = (text: string): string => text.replaceAll('\n', `\n${fence}`);
  return embeddingOf(offsets[0] ?? 0, [{ kind: 'spelled', text: example.code, offsets, spell }]);
}
