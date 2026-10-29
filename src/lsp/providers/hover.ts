/** Hovers (language-service/hover.ts), as Markdown: the code in a fenced block, then the docstring. */

import { MarkupKind } from 'vscode-languageserver/node';
import { hoverAt } from '../../language-service/hover.ts';
import { documentOffset, rangeOf } from '../locations.ts';
import type { Provider } from './provider.ts';

export const hover: Provider = {
  capabilities: { hoverProvider: true },
  register: (connection, workspace) => {
    connection.onHover((params) => {
      const at = documentOffset(workspace, params);
      const source = at && workspace.treeOf(at.module)?.source;
      const found = at && hoverAt(workspace.program, at.module, at.offset);
      if (source === undefined || found === undefined) {
        return;
      }
      const code = ['```ista', ...found.code, '```'].join('\n');
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: found.doc === undefined ? code : `${code}\n\n${found.doc}`,
        },
        range: rangeOf(source, found.span),
      };
    });
  },
};
