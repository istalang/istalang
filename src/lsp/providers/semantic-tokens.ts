/**
 * Highlighting (language-service/semantic-tokens/), encoded as LSP's semantic tokens: each token
 * relative to the one before it, by its kind's index in the legend the server announces.
 *
 * A client may not draw a token across lines, and VS Code doesn't, so one spanning lines (a
 * docstring, a multi-line string or template) is sent as one token per line.
 */

import { SemanticTokensBuilder } from 'vscode-languageserver/node';
import { checkedModule } from '../../language-service/reading/checked-module.ts';
import { builtKeyTypesOf } from '../../language-service/semantic-tokens/built-keys.ts';
import { semanticTokensOf } from '../../language-service/semantic-tokens/semantic-tokens.ts';
import { semanticTypes } from '../../language-service/semantic-tokens/semantic-types.ts';
import { type LineMap, lineMapOf } from '../../text/line-map.ts';
import type { Span } from '../../text/span.ts';
import { moduleIdOfUri } from '../locations.ts';
import type { Provider } from './provider.ts';

const typeIndex = new Map(semanticTypes.map((type, index) => [type, index]));

export const semanticTokens: Provider = {
  capabilities: {
    semanticTokensProvider: {
      legend: { tokenTypes: [...semanticTypes], tokenModifiers: [] },
      full: true,
    },
  },
  register: (connection, workspace) => {
    connection.languages.semanticTokens.on(({ textDocument }) => {
      const builder = new SemanticTokensBuilder();
      const module = moduleIdOfUri(textDocument.uri);
      const tree = workspace.treeOf(module);
      if (tree !== undefined) {
        const lines = lineMapOf(tree.source);
        const checked = checkedModule(workspace.program, module);
        const keys = checked === undefined ? undefined : builtKeyTypesOf(checked);
        for (const { span, type } of semanticTokensOf(tree, keys)) {
          for (const piece of linesOf(lines, span)) {
            const { line, column } = lines.positionAt(piece.start);
            builder.push(line, column, piece.end - piece.start, typeIndex.get(type) ?? 0, 0);
          }
        }
      }
      return builder.build();
    });
  },
};

/** The parts of `span` on each line it touches, without line breaks; empty parts dropped. */
function linesOf(lines: LineMap, span: Span): readonly Span[] {
  const first = lines.positionAt(span.start).line;
  const last = lines.positionAt(span.end).line;
  const pieces: Span[] = [];
  for (let line = first; line <= last; line += 1) {
    const bounds = lines.lineSpan(line);
    const start = Math.max(span.start, bounds.start);
    const end = Math.min(span.end, bounds.end);
    if (end > start) {
      pieces.push({ start, end });
    }
  }
  return pieces;
}
