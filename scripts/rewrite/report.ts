/**
 * What a run of the rewriter tells a person: each file it rewrites, or would, with what it can't
 * rewrite or read there, then a count of rewrites by kind of file and rule. Positions are one-based
 * `path:line:column`, as editors and terminals link them.
 */

import { LineMap } from '../../src/foundation/text/line-map.ts';
import { hunksOf } from './diff.ts';
import type { KindedRewrite, SourceKindName } from './repository.ts';

/** The report of `rewrites`, with each change's lines when `withLines`. */
export function reportOf(rewrites: readonly KindedRewrite[], withLines: boolean): string {
  const files = rewrites
    .filter(({ applied, refused, skipped }) => applied.length + refused.length + skipped.length > 0)
    .map((rewrite) => fileReport(rewrite, withLines));
  return [...files, summaryOf(rewrites)].join('\n');
}

function fileReport(rewrite: KindedRewrite, withLines: boolean): string {
  const { path, before, applied, refused, skipped } = rewrite;
  const lineMap = new LineMap(before);
  const at = (offset: number): string => {
    const { line, column } = lineMap.positionAt(offset);
    return `${path}:${line + 1}:${column + 1}`;
  };
  const lines = [`${path}: ${countsOf(applied.map(({ rule }) => rule))}`];
  if (withLines) {
    for (const hunk of hunksOf(
      before,
      applied.flatMap(({ edits }) => edits),
    )) {
      lines.push(
        `  @@ ${hunk.line}`,
        ...hunk.removed.map((line) => `  - ${line}`),
        ...hunk.added.map((line) => `  + ${line}`),
      );
    }
  }
  for (const { rule, at: offset, line, reason } of refused) {
    lines.push(`  ${at(offset)}: ${rule} not made, as ${reason}:`, `    ${line.trim()}`);
  }
  for (const { at: offset, reason } of skipped) {
    lines.push(`  ${at(offset)}: literal skipped, as ${reason}`);
  }
  return lines.join('\n');
}

function summaryOf(rewrites: readonly KindedRewrite[]): string {
  const kinds = Map.groupBy(rewrites, ({ kind }) => kind);
  const lines = [...kinds].map(([kind, files]: [SourceKindName, KindedRewrite[]]) => {
    const changed = files.filter(({ applied }) => applied.length > 0).length;
    const rules = files.flatMap(({ applied }) => applied.map(({ rule }) => rule));
    const refused = files.flatMap(({ refused: notMade }) => notMade).length;
    const skipped = files.flatMap(({ skipped: unread }) => unread).length;
    const made = `${changed} of ${files.length} files, ${countsOf(rules)}`;
    return `${kind}: ${made}; ${refused} not made, ${skipped} literals skipped`;
  });
  return ['', 'Summary', ...lines].join('\n');
}

/** How many of each rule `rules` holds, as `rule ×n`, or that it holds none. */
function countsOf(rules: readonly string[]): string {
  const counts = Map.groupBy(rules, (rule) => rule);
  return counts.size === 0
    ? 'no rewrites'
    : [...counts].map(([rule, made]) => `${rule} ×${made.length}`).join(', ');
}
