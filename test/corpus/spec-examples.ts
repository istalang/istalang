/**
 * The fenced code examples of docs/spec.md and docs/guide.md, read when tests load.
 *
 * The spec and guide are the only homes of their examples. Tests derive them on every run instead
 * of keeping copies, which would drift with the next doc edit. Each example records the heading it
 * sits under and the line where its code starts, so a failure points into its document.
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

const documentPaths = ['docs/spec.md', 'docs/guide.md'] as const;

type DocumentPath = (typeof documentPaths)[number];

export interface SpecExample {
  readonly document: DocumentPath;
  /** The title of the heading the example sits under in `document`. */
  readonly section: string;
  /** One-based line of the example's first code line in `document`. */
  readonly line: number;
  readonly code: string;
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

function extractExamples(path: DocumentPath, markdown: string): SpecExample[] {
  const examples: SpecExample[] = [];
  let section = '';
  let open: { line: number; indent: number; form: ExampleForm; lines: string[] } | undefined;
  for (const [index, line] of markdown.split('\n').entries()) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith(fence)) {
      if (open === undefined) {
        const indent = line.length - trimmed.length;
        open = { line: index + 2, indent, form: formOf(path, trimmed, index + 1), lines: [] };
      } else {
        const code = open.lines.join('\n');
        examples.push({
          document: path,
          section,
          line: open.line,
          code,
          elided: code.includes(elisionMark),
          form: open.form,
        });
        open = undefined;
      }
    } else if (open === undefined) {
      section = headingPattern.exec(line)?.groups?.title ?? section;
    } else {
      open.lines.push(line.slice(Math.min(open.indent, line.length)));
    }
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
