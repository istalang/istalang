/**
 * An `.ista` file is one Istalang source, written out as it is. A byte order mark is the file's
 * and not the source's; the engine accounts for the one `createSourceText` drops.
 */

import { type Embed, embeddingOf, verbatim } from '../embedding.ts';

export const embedIsta: Embed = (_path, contents) => ({
  embeddings: [embeddingOf(0, [verbatim(contents, 0)])],
  skipped: [],
});
