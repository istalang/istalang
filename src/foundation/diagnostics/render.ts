/**
 * Diagnostics as terminal text: a `path:line:column` header that terminals and editors turn into a
 * link, then the source line with a caret under the span.
 *
 * Lines and columns are shown 1-based, as editors count them; everything inside the toolchain is
 * 0-based. A span over several lines is underlined to the end of its first line, which is where
 * the problem starts. Tabs before the span are copied into the caret line, so the caret stays
 * aligned however wide the terminal draws a tab. A related location follows as a note in the same
 * form, so a terminal links each step of a path.
 */

import { unreachable } from '../structures/unreachable.ts';
import { lineMapOf } from '../text/line-map.ts';
import type { SourceText } from '../text/source-text.ts';
import { type Span, textOf } from '../text/span.ts';
import type { Diagnostic } from './diagnostic.ts';

/** A module's text and what was reported in it. */
export interface Diagnosed {
  readonly source: SourceText;
  readonly diagnostics: readonly Diagnostic<Span, string>[];
}

/**
 * Every diagnostic `keep` accepts of `modules`, each module's by its id, rendered in their order; a
 * related location stands in one of `modules`, whose text it is shown in.
 */
export function renderDiagnostics(
  modules: ReadonlyMap<string, Diagnosed>,
  keep: (diagnostic: Diagnostic<Span, string>) => boolean = () => true,
): readonly string[] {
  const sourceOf = (module: string) =>
    modules.get(module)?.source ??
    unreachable(`A related location stands in ${module}, which was not diagnosed.`);
  return [...modules.values()].flatMap(({ source, diagnostics }) =>
    diagnostics.filter(keep).map((diagnostic) => renderDiagnostic(source, diagnostic, sourceOf)),
  );
}

/**
 * A diagnostic as a header line plus a two-line excerpt of the source, then each related location
 * the same way, as a note, in the text `sourceOf` gives its module.
 */
function renderDiagnostic(
  source: SourceText,
  diagnostic: Diagnostic<Span, string>,
  sourceOf: (module: string) => SourceText,
): string {
  const head = `${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
  return [
    excerpt(source, diagnostic.span, head),
    ...diagnostic.related.map((related) =>
      excerpt(sourceOf(related.module), related.span, `note: ${related.message}`),
    ),
  ].join('\n');
}

/** `head` after the `path:line:column` of `span`, then the line it starts on, underlined. */
function excerpt(source: SourceText, span: Span, head: string): string {
  const lines = lineMapOf(source);
  const { line, column } = lines.positionAt(span.start);
  const lineSpan = lines.lineSpan(line);
  const lineText = textOf(source, lineSpan);
  const underlined = Math.min(span.end, lineSpan.end) - span.start;
  const indent = lineText.slice(0, column).replace(/[^\t]/gu, ' ');
  const number = String(line + 1);
  const gutter = ' '.repeat(number.length);
  return [
    `${source.path}:${line + 1}:${column + 1}: ${head}`,
    ` ${number} | ${lineText}`,
    ` ${gutter} | ${indent}${'^'.repeat(Math.max(underlined, 1))}`,
  ].join('\n');
}
