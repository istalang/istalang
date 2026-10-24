/**
 * The parser's entry: a scanned source file to its syntax tree.
 *
 * Parsing is total. Whatever the input, it returns a complete tree, with Missing and Invalid nodes
 * where the source is wrong and a diagnostic explaining each (syntax/node.ts). The tree carries the
 * scanner's diagnostics before its own, so a later phase reads one list per file.
 */

import type { SourceText } from '../../text/source-text.ts';
import type { ScanResult } from '../syntax/tokens.ts';
import type { SyntaxTree } from '../syntax/tree.ts';
import { parseModule } from './declarations/declaration.ts';
import { createParser } from './grammar.ts';

export function parse(source: SourceText, scanned: ScanResult): SyntaxTree {
  const parser = createParser(source, scanned);
  const root = parseModule(parser);
  const diagnostics = [...scanned.diagnostics, ...parser.diagnostics];
  return { source, root, comments: scanned.comments, diagnostics };
}
