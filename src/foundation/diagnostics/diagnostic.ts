/**
 * A problem found in a source, reported by any phase.
 *
 * Diagnostics are plain values that each phase returns with its result. There is no global sink,
 * so a phase stays a pure function, and the LSP can keep the diagnostics of one snapshot without
 * caring which phase produced them.
 *
 * A diagnostic holds only a span, not a file. Every phase result belongs to one source, and the
 * layer that aggregates results across modules pairs them with their module. Inside a phase that
 * keeps its results across edits, a diagnostic points at a span anchored to the syntax
 * (compiler/syntax/tree/positions.ts); it leaves the phase with the text span that becomes.
 *
 * A diagnostic may name related locations: other places that explain it, such as the steps of a
 * path. Unlike its own span, one may stand in another module, so it carries that module's id, typed
 * by the phase that names modules (`Module`). Typed without one, a diagnostic has none: every phase
 * makes those, and only the checker relates places. A reader of any takes `Diagnostic<Span, string>`.
 */

import { compareOrdered } from '../language/order.ts';
import type { Span } from '../text/span.ts';

export type Severity = 'error' | 'warning';

export interface Diagnostic<Where = Span, Module extends string = never> {
  readonly code: number;
  readonly severity: Severity;
  readonly message: string;
  readonly span: Where;
  /** Other places that explain it, in the order a reader follows them. */
  readonly related: readonly RelatedLocation<Where, Module>[];
}

/** A place that explains a diagnostic, in `module`: an editor shows `message` there. */
interface RelatedLocation<Where = Span, Module extends string = string> {
  readonly message: string;
  readonly module: Module;
  readonly span: Where;
}

/**
 * The order diagnostics are listed in: by position, then code and message, so one source always
 * lists its diagnostics alike, whichever phase found each first.
 */
export function compareDiagnostics(
  first: Diagnostic<Span, string>,
  second: Diagnostic<Span, string>,
): number {
  return (
    first.span.start - second.span.start ||
    first.span.end - second.span.end ||
    first.code - second.code ||
    compareOrdered(first.message, second.message)
  );
}

/** Whether `diagnostic` is an error: what fails a check and stops a program from compiling. */
export function isError(diagnostic: Diagnostic<unknown, string>): boolean {
  return diagnostic.severity === 'error';
}
