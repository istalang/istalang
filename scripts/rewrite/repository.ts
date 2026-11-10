/**
 * Where the repository's Istalang sources are: each kind of file that holds them, the files of each
 * kind, and how a file of the kind holds its sources. A new kind of file is one entry here.
 *
 * - `.ista` modules under `src/`, `test/` and `examples/`; a generated `*.gen.ista` is its
 *   generator's output, rewritten by running the generator again.
 * - The fenced examples of the documents the spec-example tests read.
 * - The literals of the TypeScript tests and test kits under `src/` and `test/`.
 */

import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Embed } from './embedding.ts';
import { type FileRewrite, rewriteFile } from './engine.ts';
import type { Pass } from './pass.ts';
import { embedIsta } from './sources/ista-file.ts';
import { embedMarkdown, exampleDocuments } from './sources/markdown.ts';
import { embedTypeScript } from './sources/typescript/index.ts';

interface SourceKind {
  /** The files of the kind, relative to the repository's root. */
  readonly filesIn: (root: string) => readonly string[];
  readonly embed: Embed;
}

const generated = '.gen.ista';

const sourceKinds = {
  ista: {
    filesIn: (root) =>
      globSync('{src,test,examples}/**/*.ista', { cwd: root }).filter(
        (path) => !path.endsWith(generated),
      ),
    embed: embedIsta,
  },
  markdown: { filesIn: () => exampleDocuments, embed: embedMarkdown },
  typescript: {
    filesIn: (root) => globSync('{src,test}/**/*.{test,test-kit}.ts', { cwd: root }),
    embed: embedTypeScript,
  },
} satisfies Record<string, SourceKind>;

export type SourceKindName = keyof typeof sourceKinds;

/** A file's rewrite, with the kind of file it is. */
export interface KindedRewrite extends FileRewrite {
  readonly kind: SourceKindName;
}

/** `pass` run over every source of the repository at `root`, file by file in path order. */
export function rewriteRepository(root: string, pass: Pass): readonly KindedRewrite[] {
  return Object.entries(sourceKinds).flatMap(([kind, { filesIn, embed }]) =>
    filesIn(root)
      .toSorted()
      .map((path) => ({
        kind: kind as SourceKindName,
        ...rewriteFile(path, readFileSync(join(root, path), 'utf8'), embed, pass),
      })),
  );
}
