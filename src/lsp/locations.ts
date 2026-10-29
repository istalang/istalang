/**
 * Where things are, in LSP's terms: documents by URI, and ranges by line and character.
 *
 * A module's id is already a URL (program.ts), so it is the document's URI as it is. A client may
 * spell a file's URI differently (VS Code escapes characters Node's file URLs keep), so a file URI
 * is read back through its path, which names the module the way the file loader does. LSP counts
 * characters in UTF-16 code units by default, as the toolchain's offsets do, so a position is a
 * line map's line and column.
 */

import { fileURLToPath } from 'node:url';
import type { Range } from 'vscode-languageserver/node';
import { type ModuleId, moduleIdOf } from '../compiler/program/program.ts';
import { moduleIdOfFile } from '../project/file-loader.ts';
import { lineMapOf } from '../text/line-map.ts';
import type { SourceText } from '../text/source-text.ts';
import type { Span } from '../text/span.ts';

/** The module a document's URI stands for. */
export function moduleIdOfUri(uri: string): ModuleId {
  const url = new URL(uri);
  return url.protocol === 'file:' ? moduleIdOfFile(fileURLToPath(url)) : moduleIdOf(url);
}

/** The range `span` covers in `source`. */
export function rangeOf(source: SourceText, span: Span): Range {
  const lines = lineMapOf(source);
  const start = lines.positionAt(span.start);
  const end = lines.positionAt(span.end);
  return {
    start: { line: start.line, character: start.column },
    end: { line: end.line, character: end.column },
  };
}
