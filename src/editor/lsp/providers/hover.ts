/**
 * Hovers (editor/language-service/hover.ts), as Markdown: the code in a fenced block, a line
 * linking each declared type it names to its declaration, then what documents it.
 *
 * Text in a fenced block can't link, so the types link from a line of their own. Each runs the
 * client's `ista.openLocation` (client-protocol.ts), which reaches a std module's document too.
 */

import { MarkupKind } from 'vscode-languageserver/node';
import { type Program, programModule } from '../../../compiler/program/program.ts';
import { spanIn } from '../../../compiler/syntax/tree/positions.ts';
import { hoverAt } from '../../language-service/hover.ts';
import type { TypeLink } from '../../language-service/type-links.ts';
import { openLocationTarget } from '../client-protocol.ts';
import { documentOffset, rangeOf, uriOf } from '../locations.ts';
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
      const links = found.links.map((link) => linkText(workspace.program, link));
      const sections = [code, links.length === 0 ? undefined : `Go to: ${links.join(' · ')}`];
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: [...sections, found.doc].filter((section) => section !== undefined).join('\n\n'),
        },
        range: rangeOf(source, found.span),
      };
    });
  },
};

/** `link` as a Markdown link to the name declaring its type (banner). */
function linkText(program: Program, { module, name, text }: TypeLink): string {
  const { tree } = programModule(program, module);
  const { start } = rangeOf(tree.source, spanIn(tree, name.span));
  return `[${text}](${openLocationTarget([uriOf(module), start.line, start.character])})`;
}
