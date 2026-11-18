/**
 * Going to the declaration a name denotes (editor/language-service/navigation/declarations.ts).
 *
 * Each answer is a link where the client takes one: it lands on the declaring name, and its target
 * spans the whole declaration (reading/declaring-node.ts), which an editor previews, as VS Code
 * does on a hover with Cmd held, so the preview shows a function's body and a struct's fields.
 */

import type { LocationLink } from 'vscode-languageserver/node';
import { programModule } from '../../../../compiler/program/program.ts';
import { extentIn } from '../../../../compiler/syntax/tree/index.ts';
import { spanIn } from '../../../../compiler/syntax/tree/positions.ts';
import { nameAt } from '../../../language-service/navigation/declarations.ts';
import { declaringNodeOf } from '../../../language-service/reading/declaring-node.ts';
import { documentOffset, locationOf, rangeOf, uriOf } from '../../locations.ts';
import type { Provider } from '../provider.ts';

export const definition: Provider = {
  capabilities: { definitionProvider: true },
  register: (connection, workspace, client) => {
    const linking = client.textDocument?.definition?.linkSupport === true;
    connection.onDefinition((params) => {
      const at = documentOffset(workspace, params);
      const { program } = workspace;
      const found = at && nameAt(program, at.module, at.offset);
      if (at === undefined || found === undefined) {
        return;
      }
      const declarations = found.declarations.map(({ at: declared }) => declared);
      if (!linking) {
        return declarations.map((declared) =>
          locationOf(program, declared.module, declared.name.span),
        );
      }
      const origin = programModule(program, at.module).tree;
      const originSelectionRange = rangeOf(origin.source, spanIn(origin, found.name.span));
      return declarations.map((declared): LocationLink => {
        const { tree } = programModule(program, declared.module);
        return {
          originSelectionRange,
          targetUri: uriOf(declared.module),
          targetRange: rangeOf(tree.source, extentIn(tree, declaringNodeOf(tree, declared.name))),
          targetSelectionRange: rangeOf(tree.source, spanIn(tree, declared.name.span)),
        };
      });
    });
  },
};
