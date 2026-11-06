/** Where a document folds (editor/language-service/outline/folding.ts), as LSP's folding ranges. */

import { foldingRangesOf } from '../../../language-service/outline/folding.ts';
import { moduleIdOfUri } from '../../locations.ts';
import type { Provider } from '../provider.ts';

export const foldingRanges: Provider = {
  capabilities: { foldingRangeProvider: true },
  register: (connection, workspace) => {
    connection.onFoldingRanges(({ textDocument }) => {
      const tree = workspace.treeOf(moduleIdOfUri(textDocument.uri));
      return (
        tree && foldingRangesOf(tree).map(({ start, end }) => ({ startLine: start, endLine: end }))
      );
    });
  },
};
