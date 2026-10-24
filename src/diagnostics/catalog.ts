/**
 * Declares a phase's diagnostics in one table.
 *
 * Each phase owns one catalog, which is the single home of its codes and messages. Messages are
 * functions, so their arguments are typed at every call site. The returned factories produce
 * Diagnostic values, so a phase never assembles one by hand.
 *
 * Codes are stable public identifiers, shown to users and matched by tests and tooling, so they are
 * written out explicitly and never derived from table order. Each phase owns a block of a thousand
 * (scanner 1000s, parser 2000s, and so on). Duplicates within a catalog are a programming error and
 * throw when the module loads.
 */

import type { Span } from '../text/span.ts';
import type { Diagnostic, Severity } from './diagnostic.ts';

interface DiagnosticTemplate {
  readonly code: number;
  /** Defaults to `error`. */
  readonly severity?: Severity;
  readonly message: (...args: never[]) => string;
}

/** Makes a diagnostic; `code` identifies it without making one. */
type DiagnosticFactory<Args extends readonly unknown[]> = ((
  span: Span,
  ...args: Args
) => Diagnostic) & {
  readonly code: number;
};

type Catalog<Templates extends Record<string, DiagnosticTemplate>> = {
  readonly [Name in keyof Templates]: DiagnosticFactory<Parameters<Templates[Name]['message']>>;
};

/** Turns a table of templates into typed diagnostic factories. */
export function defineDiagnostics<const Templates extends Record<string, DiagnosticTemplate>>(
  templates: Templates,
): Catalog<Templates> {
  const seen = new Set<number>();
  const factories: Record<string, DiagnosticFactory<never[]>> = {};
  for (const [name, template] of Object.entries(templates)) {
    if (seen.has(template.code)) {
      throw new Error(`Diagnostic code ${template.code} is declared twice (at '${name}').`);
    }
    seen.add(template.code);
    const make = (span: Span, ...args: never[]): Diagnostic => ({
      code: template.code,
      severity: template.severity ?? 'error',
      message: template.message(...args),
      span,
    });
    factories[name] = Object.assign(make, { code: template.code });
  }
  return factories as Catalog<Templates>;
}
