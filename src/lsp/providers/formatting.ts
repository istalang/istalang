/**
 * Formatting a document: the canonical format (formatter/format.ts) as one edit replacing the
 * whole text. It has no options, so the client's tab size and spaces are ignored; a document with
 * syntax errors is left as it is, as `ista fmt` leaves its file.
 */

import { formatTree } from '../../formatter/format.ts';
import { moduleIdOfUri, rangeOf } from '../locations.ts';
import type { Provider } from './provider.ts';

export const formatting: Provider = {
  capabilities: { documentFormattingProvider: true },
  register: (connection, workspace) => {
    connection.onDocumentFormatting(({ textDocument }) => {
      const tree = workspace.treeOf(moduleIdOfUri(textDocument.uri));
      const formatted = tree && formatTree(tree);
      if (tree === undefined || formatted === undefined || formatted === tree.source.text) {
        return [];
      }
      const whole = { start: 0, end: tree.source.text.length };
      return [{ range: rangeOf(tree.source, whole), newText: formatted }];
    });
  },
};
