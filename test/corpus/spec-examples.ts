/**
 * The fenced code examples of docs/spec.md and docs/guide.md, read when tests load.
 *
 * The spec and guide are the only homes of their examples. Tests derive them on every run instead
 * of keeping copies, which would drift with the next doc edit. Each example records the heading it
 * sits under and the line where its code starts, so a failure points into its document.
 *
 * Each also records where each of its code lines starts in its document and the indentation its
 * fence strips, so a tool editing examples in place (scripts/rewrite) maps its edits back into the
 * document. `extractExamples` reads a document's text as given, for such a tool's text in hand.
 *
 * Some examples use `…` to mark omitted code, so they aren't valid source as written. `elided` is
 * derived from the text, never kept in a hand-maintained list, so a new elided example needs no
 * test change. Others use `...` the same way, which only parsing tells apart from a spread;
 * `isPlaceholder` recognizes the text such a placeholder leaves in a diagnostic.
 *
 * Most examples are whole modules. The rest say what they are in their fence's info string, after
 * the language: ` ```python statements` for statements shown outside any function, which a module
 * can't hold at its top level, and ` ```python fragment` for samples that are neither, such as the
 * cheat sheet's. An unknown word there fails every test at load, so a typo can't hide an example.
 */

import { readFileSync } from 'node:fs';

/** A whole module, statements shown outside any function, or a sample that is neither. */
type ExampleForm = 'module' | 'statements' | 'fragment';

/** The documents holding examples, relative to the repository's root. */
export const documentPaths = ['docs/spec.md', 'docs/guide.md'] as const;

type DocumentPath = (typeof documentPaths)[number];

export interface SpecExample {
  readonly document: DocumentPath;
  /** The title of the heading the example sits under in `document`. */
  readonly section: string;
  /** One-based line of the example's first code line in `document`. */
  readonly line: number;
  readonly code: string;
  /** The UTF-16 offset in `document` where each line of `code` starts, past its indentation. */
  readonly codeStarts: readonly number[];
  /** The indentation of the example's fence, which each of its lines in `document` drops. */
  readonly indentation: string;
  readonly elided: boolean;
  readonly form: ExampleForm;
}

const headingPattern = /^#{1,6}\s+(?<title>.+)$/u;
const fence = '```';
const elisionMark = '…';
const whitespace = /\s+/u;

const formTags: Readonly<Record<string, ExampleForm>> = {
  '': 'module',
  statements: 'statements',
  fragment: 'fragment',
};

/** The form an opening fence's info string declares: the words after the language. */
function formOf(path: string, openingFence: string, line: number): ExampleForm {
  const tag = openingFence.slice(fence.length).trim().split(whitespace).slice(1).join(' ');
  const form = formTags[tag];
  if (form === undefined) {
    throw new Error(`${path}:${line}: unknown example form '${tag}'`);
  }
  return form;
}

const placeholders = ['...', '…'];

/** Whether `text` is only placeholders for omitted code, with any braces around them. */
export function isPlaceholder(text: string): boolean {
  const rest = placeholders.reduce((remaining, mark) => remaining.replaceAll(mark, ''), text);
  return rest !== text && rest.replaceAll(/[{}\s]/gu, '') === '';
}

interface OpenExample {
  readonly line: number;
  readonly indentation: string;
  readonly form: ExampleForm;
  readonly lines: string[];
  readonly codeStarts: number[];
}

/** The examples of `markdown`, the text of the document at `path`. */
export function extractExamples(path: DocumentPath, markdown: string): SpecExample[] {
  const examples: SpecExample[] = [];
  let section = '';
  let open: OpenExample | undefined;
  let lineStart = 0;
  for (const [index, line] of markdown.split('\n').entries()) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith(fence)) {
      if (open === undefined) {
        const indentation = line.slice(0, line.length - trimmed.length);
        const form = formOf(path, trimmed, index + 1);
        open = { line: index + 2, indentation, form, lines: [], codeStarts: [] };
      } else {
        const code = open.lines.join('\n');
        examples.push({
          document: path,
          section,
          line: open.line,
          code,
          codeStarts: open.codeStarts,
          indentation: open.indentation,
          elided: code.includes(elisionMark),
          form: open.form,
        });
        open = undefined;
      }
    } else if (open === undefined) {
      section = headingPattern.exec(line)?.groups?.title ?? section;
    } else {
      const stripped = Math.min(open.indentation.length, line.length);
      open.lines.push(line.slice(stripped));
      open.codeStarts.push(lineStart + stripped);
    }
    lineStart += line.length + 1;
  }
  return examples;
}

export const specExamples: readonly SpecExample[] = documentPaths.flatMap((path) =>
  extractExamples(path, readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')),
);

/** The code of every spec example in `section` that `wanted` picks; throws when it picks none. */
export function specCode(
  section: string,
  wanted: (code: string) => boolean = () => true,
): string[] {
  const found = specExamples
    .filter(
      (example) =>
        example.document === 'docs/spec.md' && example.section === section && wanted(example.code),
    )
    .map(({ code }) => code);
  if (found.length === 0) {
    throw new Error(`No example in "${section}" is the one wanted.`);
  }
  return found;
}
