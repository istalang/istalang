/** Going to the declaration a name denotes (language-service/navigation/declarations.ts). */

import { nameAt } from '../../../language-service/navigation/declarations.ts';
import { documentOffset, locationOf } from '../../locations.ts';
import type { Provider } from '../provider.ts';

export const definition: Provider = {
  capabilities: { definitionProvider: true },
  register: (connection, workspace) => {
    connection.onDefinition((params) => {
      const at = documentOffset(workspace, params);
      const { program } = workspace;
      return (
        at &&
        nameAt(program, at.module, at.offset)?.declarations.map((declaration) =>
          locationOf(program, declaration.at.module, declaration.at.name.span),
        )
      );
    });
  },
};
