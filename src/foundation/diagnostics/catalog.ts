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
import { codeBlockSize, codeBlocks, type DiagnosticPhase } from './code-blocks.ts';
import type { Diagnostic, Severity } from './diagnostic.ts';

interface DiagnosticTemplate {
  readonly code: number;
  /** Defaults to `error`. */
  readonly severity?: Severity;
  readonly message: (...args: never[]) => string;
}

/**
 * Makes a diagnostic at a span of either kind; `code` identifies it without making one, and
 * `argumentsOf` reads back what one it made was made from.
 */
type DiagnosticFactory<Args extends readonly unknown[]> = (<Where>(
  span: Where,
  ...args: Args
) => Diagnostic<Where>) & {
  readonly code: number;
  /** The arguments `diagnostic` was made with, if this factory made it. */
  readonly argumentsOf: (diagnostic: Diagnostic<unknown, string>) => Args | undefined;
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
    const make = <Where>(span: Where, ...args: never[]): Diagnostic<Where> => ({
      code: template.code,
      severity: template.severity ?? 'error',
      message: template.message(...args),
      span,
      arguments: args,
      related: [],
    });
    const argumentsOf = (diagnostic: Diagnostic<unknown, string>): never[] | undefined =>
      diagnostic.code === template.code ? (diagnostic.arguments as never[]) : undefined;
    factories[name] = Object.assign(make, { code: template.code, argumentsOf });
  }
  return factories as Catalog<Templates>;
}
