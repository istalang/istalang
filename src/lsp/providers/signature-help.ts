/** Signature help (language-service/signature-help.ts), its parameters marked by label offsets. */

import { signatureHelpAt } from '../../language-service/signature-help.ts';
import { documentOffset } from '../locations.ts';
import type { Provider } from './provider.ts';

export const signatureHelp: Provider = {
  capabilities: { signatureHelpProvider: { triggerCharacters: ['(', ','] } },
  register: (connection, workspace) => {
    connection.onSignatureHelp((params) => {
      const at = documentOffset(workspace, params);
      const help = at && signatureHelpAt(workspace.program, at.module, at.offset);
      if (help === undefined) {
        return;
      }
      const signatures = help.signatures.map(({ label, parameters, activeParameter }) => ({
        label,
        parameters: parameters.map(([start, end]) => ({ label: [start, end] as [number, number] })),
        activeParameter: activeParameter ?? null,
      }));
      return {
        signatures,
        activeSignature: help.active,
        activeParameter: help.signatures[help.active]?.activeParameter ?? null,
      };
    });
  },
};
