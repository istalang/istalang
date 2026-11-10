/**
 * The rewriter's engine: a pass run over each Istalang source a file holds, its rewrites made in
 * the file wherever the file can spell them, and reported wherever it can't. It reads and writes
 * nothing itself, so every kind of file goes through the same steps.
 *
 * A rewrite is made whole or not at all: one edit the file can't make refuses its rewrite, never
 * the source's other rewrites. Every source a pass rewrites is read again rewritten, and a pass
 * that finds more to do there throws: running a pass twice must change nothing the second time,
 * and checking it on every source rewritten holds each pass to that on real code.
 */

import { LineMap } from '../../src/foundation/text/line-map.ts';
import { applyEdits } from './edits.ts';
import { type Embed, type Embedding, fileEditOf, type Skipped } from './embedding.ts';
import { type Edit, type Pass, type Rewrite, readIsta } from './pass.ts';

/** A rewrite made in a file, by its file edits. */
interface Applied {
  readonly rule: string;
  readonly edits: readonly Edit[];
}

/** A rewrite the file can't make, with the line of source it was to change. */
interface Refused {
  readonly rule: string;
  /** Where the source it was in starts in the file. */
  readonly at: number;
  readonly line: string;
  readonly reason: string;
}

export interface FileRewrite {
  readonly path: string;
  readonly before: string;
  readonly after: string;
  readonly applied: readonly Applied[];
  readonly refused: readonly Refused[];
  readonly skipped: readonly Skipped[];
}

/** `pass` run over every source `embed` finds in `contents`. */
export function rewriteFile(path: string, contents: string, embed: Embed, pass: Pass): FileRewrite {
  const { embeddings, skipped } = embed(path, contents);
  const applied: Applied[] = [];
  const refused: Refused[] = [];
  for (const embedding of embeddings) {
    for (const rewrite of rewritesOf(`${path}:${embedding.at}`, embedding.text, pass)) {
      const made = madeIn(embedding, rewrite);
      if ('reason' in made) {
        refused.push(made);
      } else {
        applied.push(made);
      }
    }
  }
  const after = applyEdits(
    contents,
    applied.flatMap(({ edits }) => edits),
  );
  return { path, before: contents, after, applied, refused, skipped };
}

/**
 * The rewrites `pass` makes in `text`, as offsets of `text`; throws if it would rewrite them again.
 * `label` names the source in that error.
 */
export function rewritesOf(label: string, text: string, pass: Pass): readonly Rewrite[] {
  const rewrites = rewritesIn(label, text, pass);
  if (rewrites.length > 0) {
    const rewritten = applyEdits(
      text,
      rewrites.flatMap(({ edits }) => edits),
    );
    const again = rewritesIn(label, rewritten, pass);
    if (again.length > 0) {
      const rules = again.map(({ rule }) => rule).join(', ');
      throw new Error(`${label}: the pass rewrites its own output again (${rules}):\n${rewritten}`);
    }
  }
  return rewrites;
}

/** The rewrites of `text`, offsets past a byte order mark the source text drops included. */
function rewritesIn(label: string, text: string, pass: Pass): readonly Rewrite[] {
  const input = readIsta(label, text);
  const dropped = text.length - input.source.text.length;
  return pass(input).map(({ rule, edits }) => ({
    rule,
    edits: edits.map(({ span, text: replacement }) => ({
      span: { start: span.start + dropped, end: span.end + dropped },
      text: replacement,
    })),
  }));
}

function madeIn(embedding: Embedding, { rule, edits }: Rewrite): Applied | Refused {
  const fileEdits: Edit[] = [];
  for (const edit of edits) {
    const made = fileEditOf(embedding, edit);
    if ('refusal' in made) {
      const lineMap = new LineMap(embedding.text);
      const line = lineMap.lineSpan(lineMap.positionAt(edit.span.start).line);
      return {
        rule,
        at: embedding.at,
        line: embedding.text.slice(line.start, line.end),
        reason: made.refusal,
      };
    }
    fileEdits.push(made);
  }
  return { rule, edits: fileEdits };
}
