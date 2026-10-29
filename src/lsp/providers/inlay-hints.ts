/** Inlay hints (language-service/inlay-hints.ts), as LSP's type hints. */

import { InlayHintKind } from 'vscode-languageserver/node';
import { inlayHintsIn } from '../../language-service/inlay-hints.ts';
import { lineMapOf } from '../../text/line-map.ts';
import { moduleIdOfUri, spanOf } from '../locations.ts';
import type { Provider } from './provider.ts';

export const inlayHints: Provider = {
  capabilities: { inlayHintProvider: true },
  register: (connection, workspace) => {
    connection.languages.inlayHint.on(({ textDocument, range }) => {
      const module = moduleIdOfUri(textDocument.uri);
      const source = workspace.treeOf(module)?.source;
      if (source === undefined) {
        return [];
      }
      const lines = lineMapOf(source);
      return inlayHintsIn(workspace.program, module, spanOf(source, range)).map(
        ({ offset, label }) => {
          const { line, column } = lines.positionAt(offset);
          return { position: { line, character: column }, label, kind: InlayHintKind.Type };
        },
      );
    });
  },
};
