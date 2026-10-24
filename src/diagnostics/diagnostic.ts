/**
 * A problem found in a source, reported by any phase.
 *
 * Diagnostics are plain values that each phase returns with its result. There is no global sink,
 * so a phase stays a pure function, and the LSP can keep the diagnostics of one snapshot without
 * caring which phase produced them.
 *
 * A diagnostic holds only a span, not a file. Every phase result belongs to one source, and the
 * layer that aggregates results across modules pairs them with their module.
 */

import type { Span } from '../text/span.ts';

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  readonly code: number;
  readonly severity: Severity;
  readonly message: string;
  readonly span: Span;
}
