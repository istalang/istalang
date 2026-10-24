/**
 * The fenced code examples of docs/spec.md, read when tests load.
 *
 * The spec is the only home of its examples. Tests derive them on every run instead of keeping
 * copies, which would drift with the next spec edit. Each example records the heading it sits
 * under and the line where its code starts, so a failure points into the spec.
 *
 * Some examples use `…` to mark omitted code, so they aren't valid source as written. `elided` is
 * derived from the text, never kept in a hand-maintained list, so a new elided example needs no
 * test change.
 */

import { readFileSync } from 'node:fs';

export interface SpecExample {
  readonly section: string;
  /** One-based line in docs/spec.md of the example's first code line. */
  readonly line: number;
  readonly code: string;
  readonly elided: boolean;
}

const specUrl = new URL('../../docs/spec.md', import.meta.url);
const headingPattern = /^#{1,6}\s+(?<title>.+)$/u;
const fence = '```';
const elisionMark = '…';

function extractExamples(markdown: string): SpecExample[] {
  const examples: SpecExample[] = [];
  let section = '';
  let open: { line: number; lines: string[] } | undefined;
  for (const [index, line] of markdown.split('\n').entries()) {
    if (line.startsWith(fence)) {
      if (open === undefined) {
        open = { line: index + 2, lines: [] };
      } else {
        const code = open.lines.join('\n');
        examples.push({ section, line: open.line, code, elided: code.includes(elisionMark) });
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
