/**
 * Diagnostics of loading a program, codes 3000–3999: import paths that name no module, or more than
 * one (§3.13). Each points at the import's path string.
 */

import { defineDiagnostics } from '../../diagnostics/catalog.ts';

export const programDiagnostics = defineDiagnostics('program', {
  unresolvedImport: {
    code: 3000,
    message: (path: string) => `No module is named '${path}'.`,
  },
  ambiguousImport: {
    code: 3001,
    message: (path: string, modules: readonly string[]) =>
      `'${path}' names more than one module: ${modules.join(', ')}.`,
  },
});
