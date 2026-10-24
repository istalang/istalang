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
 * Most examples are whole modules. The rest are listed in `classifications`, each with its reason:
 * statements shown outside any function, which a module can't hold at its top level, and the cheat
 * sheet's one-line samples. A classification names a section and, within it, the first line of
 * its example, so it survives edits elsewhere in the spec.
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

export interface Classification {
  readonly section: string;
  /** The example's first line starts with this; undefined classifies the whole section. */
  readonly firstLine: string | undefined;
  readonly form: Exclude<ExampleForm, 'module'>;
  readonly reason: string;
}

const outsideFunction = 'statements shown outside any function';

export const classifications: readonly Classification[] = [
  {
    section: 'Cheat sheet',
    firstLine: undefined,
    form: 'fragment',
    reason: 'one-line samples of literals, types, statements and declarations side by side',
  },
  ...[
    ['3.3 Functions', 'fn retry('],
    ['3.4 Variables', 'const limit: int = 50_000'],
    ['3.4 Variables', 'for role in roles:'],
    ['3.9 Operator overloading', 'const u = Shared('],
    ['3.11 Enums', 'if r is Ok{'],
    ['3.12 Errors', 'async fn pay('],
    ['3.14 Function types and closures', 'bus.subscribe('],
    ['3.15 Tuples', 'fn minMax('],
    ['4. Expressions and control flow', 'const total = {'],
    ['4. Expressions and control flow', 'const size = if'],
    ['6. Slots and inboxes', 'const box = Inbox.create'],
    ['7. Lifetimes and disposal', 'const sub = Shared'],
    ['8. select', 'const deadline: Future<unit>'],
  ].map(([section = '', firstLine]) => ({
    section,
    firstLine,
    form: 'statements' as const,
    reason: outsideFunction,
  })),
];

/** Whether a classification covers an example. */
export function classifies(classification: Classification, section: string, code: string): boolean {
  const { firstLine } = classification;
  return (
    classification.section === section && (firstLine === undefined || code.startsWith(firstLine))
  );
}

function formOf(section: string, code: string): ExampleForm {
  return classifications.find((each) => classifies(each, section, code))?.form ?? 'module';
}

const placeholders = ['...', '…'];

/** Whether `text` is only placeholders for omitted code, with any braces around them. */
export function isPlaceholder(text: string): boolean {
  const rest = placeholders.reduce((remaining, mark) => remaining.replaceAll(mark, ''), text);
  return rest !== text && rest.replaceAll(/[{}\s]/gu, '') === '';
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
        examples.push({
          section,
          line: open.line,
          code,
          elided: code.includes(elisionMark),
          form: formOf(section, code),
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
