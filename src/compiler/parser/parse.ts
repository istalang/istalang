/**
 * The parser's entry: a scanned source file to its syntax tree.
 *
 * Parsing is total. Whatever the input, it returns a complete tree, with Missing and Invalid nodes
 * where the source is wrong and a diagnostic explaining each (syntax/tree/node.ts). The tree
 * carries the scanner's diagnostics before its own, so a later phase reads one list per file.
 *
 * Given the tree of the text before an edit, the new tree keeps that tree's nodes for every segment
 * the edit left alike (incremental/reuse.ts), so what later phases derived from them outlives the
 * edit.
 */

import type { SourceText } from '../../text/source-text.ts';
import type { ScanResult } from '../syntax/tokens/index.ts';
import type { SyntaxTree } from '../syntax/tree/index.ts';
import { parseModule } from './grammar/declarations/declaration.ts';
import { createParser } from './grammar/index.ts';
import { bodiesHeldBy } from './incremental/held-bodies.ts';
import { reusingSegments } from './incremental/reuse.ts';

export function parse(source: SourceText, scanned: ScanResult, previous?: SyntaxTree): SyntaxTree {
  const parser = createParser(source, scanned);
  const root = parseModule(parser);
  const diagnostics = [...scanned.diagnostics, ...parser.diagnostics];
  const parsed = { source, root, bases: parser.bases, comments: scanned.comments, diagnostics };
  return previous === undefined
    ? { ...parsed, bodies: bodiesHeldBy([root], parser.recordedBodies) }
    : reusingSegments({ ...parsed, bodies: parser.recordedBodies }, previous);
}
