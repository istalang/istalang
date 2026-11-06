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
      const active = help.active === undefined ? undefined : help.signatures[help.active];
      // The protocol has no "none": a help with no active signature leaves it to the client.
      return {
        signatures,
        ...(help.active === undefined ? {} : { activeSignature: help.active }),
        activeParameter: active?.activeParameter ?? null,
      };
    });
  },
};
