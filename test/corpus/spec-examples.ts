/**
 * The fenced code examples of docs/spec.md, read when tests load.
 *
 * The spec is the only home of its examples. Tests derive them on every run instead of keeping
 * copies, which would drift with the next spec edit. Each example records the heading it sits
 * under and the line where its code starts, so a failure points into the spec.
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
export type ExampleForm = 'module' | 'statements' | 'fragment';

export interface SpecExample {
  readonly section: string;
  /** One-based line in docs/spec.md of the example's first code line. */
  readonly line: number;
  readonly code: string;
  readonly elided: boolean;
  readonly form: ExampleForm;
}

const specUrl = new URL('../../docs/spec.md', import.meta.url);
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
function formOf(openingFence: string, line: number): ExampleForm {
  const tag = openingFence.slice(fence.length).trim().split(whitespace).slice(1).join(' ');
  const form = formTags[tag];
  if (form === undefined) {
    throw new Error(`docs/spec.md:${line}: unknown example form '${tag}'`);
  }
  return form;
}

const placeholders = ['...', '…'];

/** Whether `text` is only placeholders for omitted code, with any braces around them. */
export function isPlaceholder(text: string): boolean {
  const rest = placeholders.reduce((remaining, mark) => remaining.replaceAll(mark, ''), text);
  return rest !== text && rest.replaceAll(/[{}\s]/gu, '') === '';
}

function extractExamples(markdown: string): SpecExample[] {
  const examples: SpecExample[] = [];
  let section = '';
  let open: { line: number; form: ExampleForm; lines: string[] } | undefined;
  for (const [index, line] of markdown.split('\n').entries()) {
    if (line.startsWith(fence)) {
      if (open === undefined) {
        open = { line: index + 2, form: formOf(line, index + 1), lines: [] };
      } else {
        const code = open.lines.join('\n');
        examples.push({
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
      open.lines.push(line);
    }
  }
  return examples;
}

export const specExamples: readonly SpecExample[] = extractExamples(readFileSync(specUrl, 'utf8'));
