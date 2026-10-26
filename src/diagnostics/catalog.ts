/**
 * Declares a phase's diagnostics in one table.
 *
 * Each phase owns one catalog, which is the single home of its codes and messages. Messages are
 * functions, so their arguments are typed at every call site. The returned factories produce
 * Diagnostic values, so a phase never assembles one by hand.
 *
 * Codes are stable public identifiers, shown to users and matched by tests and tooling, so they are
 * written out explicitly and never derived from table order. Each phase owns a block of codes
 * (code-blocks.ts). A code outside its phase's block, or declared twice, is a programming error and
 * throws when the module loads, so no two catalogs can collide.
 */

import { unreachable } from '../structures/unreachable.ts';
import type { Span } from '../text/span.ts';
import { codeBlockSize, codeBlocks, type DiagnosticPhase } from './code-blocks.ts';
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

/** Turns a phase's table of templates into typed diagnostic factories. */
export function defineDiagnostics<const Templates extends Record<string, DiagnosticTemplate>>(
  phase: DiagnosticPhase,
  templates: Templates,
): Catalog<Templates> {
  const block = codeBlocks[phase];
  const seen = new Set<number>();
  const factories: Record<string, DiagnosticFactory<never[]>> = {};
  for (const [name, template] of Object.entries(templates)) {
    if (template.code < block || template.code >= block + codeBlockSize) {
      unreachable(`Diagnostic code ${template.code} ('${name}') is outside the ${phase} block.`);
    }
    if (seen.has(template.code)) {
      unreachable(`Diagnostic code ${template.code} is declared twice (at '${name}').`);
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
