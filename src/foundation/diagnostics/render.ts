/**
 * Diagnostics as terminal text: a `path:line:column` header that terminals and editors turn into a
 * link, then the source line with a caret under the span.
 *
 * Lines and columns are shown 1-based, as editors count them; everything inside the toolchain is
 * 0-based. A span over several lines is underlined to the end of its first line, which is where
 * the problem starts. Tabs before the span are copied into the caret line, so the caret stays
 * aligned however wide the terminal draws a tab.
 */

import { lineMapOf } from '../text/line-map.ts';
import type { SourceText } from '../text/source-text.ts';
import { textOf } from '../text/span.ts';
import type { Diagnostic } from './diagnostic.ts';

/** A diagnostic as a header line plus a two-line excerpt of the source. */
export function renderDiagnostic(source: SourceText, diagnostic: Diagnostic): string {
  const lines = lineMapOf(source);
  const { line, column } = lines.positionAt(diagnostic.span.start);
  const lineSpan = lines.lineSpan(line);
  const lineEnd = lineSpan.end;
  const lineText = textOf(source, lineSpan);
  const underlined = Math.min(diagnostic.span.end, lineEnd) - diagnostic.span.start;
  const indent = lineText.slice(0, column).replace(/[^\t]/gu, ' ');
  const number = String(line + 1);
  const gutter = ' '.repeat(number.length);
  return [
    `${source.path}:${line + 1}:${column + 1}: ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`,
    ` ${number} | ${lineText}`,
    ` ${gutter} | ${indent}${'^'.repeat(Math.max(underlined, 1))}`,
  ].join('\n');
}
