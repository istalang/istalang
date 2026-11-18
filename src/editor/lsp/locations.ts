/**
 * Where things are, in LSP's terms: documents by URI, and ranges by line and character.
 *
 * A module's id is already a URL (program.ts), so a file's is the document's URI as it is. A std
 * module's (`std:json`) names no extension, and an editor tells a document's language by its URI's
 * extension before it reads anything else (VS Code shows a definition's preview by it), so its
 * document is `std:json.ista` (`uriOf`). A client may spell a file's URI differently (VS Code
 * escapes characters Node's file URLs keep), so a file URI is read back through its path, which
 * names the module the way the file loader does. LSP counts
 * characters in UTF-16 code units by default, as the toolchain's offsets do, so a position is a
 * line map's line and column.
 */

import { fileURLToPath } from 'node:url';
import type {
  Location,
  Position,
  Range,
  TextDocumentPositionParams,
} from 'vscode-languageserver/node';
import {
  type ModuleId,
  moduleIdOf,
  type Program,
  programModule,
  stdModuleIdOf,
} from '../../compiler/program/program.ts';
import { type AnchoredSpan, spanIn } from '../../compiler/syntax/tree/positions.ts';
import { stdScheme } from '../../foundation/language/well-known/index.ts';
import { lineMapOf } from '../../foundation/text/line-map.ts';
import type { SourceText } from '../../foundation/text/source-text.ts';
import type { Span } from '../../foundation/text/span.ts';
import { moduleIdOfFile } from '../../project/file-loader.ts';
import type { Workspace } from '../language-service/workspace.ts';

/** The module a document's URI stands for: `uriOf` read back. */
export function moduleIdOfUri(uri: string): ModuleId {
  const url = new URL(uri);
  if (url.protocol === 'file:') {
    return moduleIdOfFile(fileURLToPath(url));
  }
  return url.protocol === stdProtocol && url.pathname.endsWith(stdExtension)
    ? stdModuleIdOf(url.pathname.slice(0, -stdExtension.length))
    : moduleIdOf(url);
}

const stdProtocol = `${stdScheme}:`;
const stdExtension = '.ista';

/** The URI of `module`'s document (banner). */
export function uriOf(module: ModuleId): string {
  return module.startsWith(stdProtocol) ? `${module}${stdExtension}` : module;
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

/** The span `range` covers in `source`: `rangeOf` read back. */
export function spanOf(source: SourceText, range: Range): Span {
  return { start: offsetOf(source, range.start), end: offsetOf(source, range.end) };
}

/** The offset `position` stands at in `source`. */
function offsetOf(source: SourceText, position: Position): number {
  return lineMapOf(source).offsetAt({ line: position.line, column: position.character });
}

/** The module a request's document stands for, and the offset its position stands at there. */
export function documentOffset(
  workspace: Workspace,
  { textDocument, position }: TextDocumentPositionParams,
): { readonly module: ModuleId; readonly offset: number } | undefined {
  const module = moduleIdOfUri(textDocument.uri);
  const source = workspace.treeOf(module)?.source;
  return source && { module, offset: offsetOf(source, position) };
}

/** Where `span` of `module` of `program` is. */
export function locationOf(program: Program, module: ModuleId, span: AnchoredSpan): Location {
  const { tree } = programModule(program, module);
  return { uri: uriOf(module), range: rangeOf(tree.source, spanIn(tree, span)) };
}
