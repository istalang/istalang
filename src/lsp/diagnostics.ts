/**
 * Diagnostics pushed to the client for every open document, after every change.
 *
 * An edit to one module can change what another reports (an importer of a renamed function), so
 * each pass publishes every open document's, not only the edited one's. A pass checks every open
 * document against a new program, so changes arriving together (a burst of keystrokes, documents
 * opened together) are published once, when they pause.
 * A closed document's diagnostics are cleared, since the client shows only what it was last sent.
 *
 * A compiler bug while diagnosing one module is logged to the client, and the others are still
 * published: one broken module must not leave every document's diagnostics stale.
 */

import type { Connection, Diagnostic as LspDiagnostic } from 'vscode-languageserver/node';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import type { ModuleId } from '../compiler/program/program.ts';
import type { Diagnostic, Severity } from '../foundation/diagnostics/diagnostic.ts';
import type { SourceText } from '../foundation/text/source-text.ts';
import type { Workspace } from '../language-service/workspace.ts';
import { rangeOf } from './locations.ts';

/** How long changes must pause before a pass runs. */
const quietMilliseconds = 50;

const severities = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
} as const satisfies Record<Severity, DiagnosticSeverity>;

/** What publishes the diagnostics of `workspace`'s open documents. */
export interface DiagnosticsPublisher {
  /** Publishes every open document's diagnostics once changes pause. */
  readonly schedule: () => void;
  /** Clears what the client shows for a document closed now. */
  readonly clear: (module: ModuleId) => void;
  /** Drops a pass not run yet: the client is shutting the server down. */
  readonly stop: () => void;
}

export function diagnosticsPublisher(
  connection: Connection,
  workspace: Workspace,
): DiagnosticsPublisher {
  let pending: NodeJS.Timeout | undefined;
  const publish = () => {
    for (const module of workspace.openModules) {
      try {
        const diagnosed = workspace.diagnosticsOf(module);
        connection.sendDiagnostics({
          uri: module,
          diagnostics:
            diagnosed?.diagnostics.map((diagnostic) =>
              lspDiagnostic(diagnosed.source, diagnostic),
            ) ?? [],
        });
      } catch (error) {
        connection.console.error(
          `ista: diagnosing ${module} failed: ${error instanceof Error ? error.stack : String(error)}`,
        );
      }
    }
  };
  return {
    schedule: () => {
      clearTimeout(pending);
      pending = setTimeout(publish, quietMilliseconds);
    },
    clear: (module) => {
      connection.sendDiagnostics({ uri: module, diagnostics: [] });
    },
    stop: () => {
      clearTimeout(pending);
    },
  };
}

function lspDiagnostic(source: SourceText, diagnostic: Diagnostic): LspDiagnostic {
  return {
    range: rangeOf(source, diagnostic.span),
    severity: severities[diagnostic.severity],
    code: diagnostic.code,
    source: 'ista',
    message: diagnostic.message,
  };
}
