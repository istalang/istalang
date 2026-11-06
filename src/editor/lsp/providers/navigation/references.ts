/**
 * Finding every name denoting what the name at a position denotes, in any module
 * (editor/language-service/navigation/references.ts); the declaring names only when the client
 * asks.
 */

import { referencesAt } from '../../../language-service/navigation/references.ts';
import { documentOffset, locationOf } from '../../locations.ts';
import type { Provider } from '../provider.ts';

export const references: Provider = {
  capabilities: { referencesProvider: true },
  register: (connection, workspace) => {
    connection.onReferences((params) => {
      const at = documentOffset(workspace, params);
      const { program } = workspace;
      return (
        at &&
        referencesAt(program, at.module, at.offset)
          .filter(({ declares }) => params.context.includeDeclaration || !declares)
          .map(({ module, name }) => locationOf(program, module, name.span))
      );
    });
  },
};
