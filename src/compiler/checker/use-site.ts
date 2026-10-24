/**
 * Where something is used, for checks that look at what is visible there and report there: the
 * module whose scope they search, the span they report at, and how they report. A search whose
 * failure its caller reports as a whole searches through a site that reports nothing.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { Span } from '../../text/span.ts';
import type { ModuleId } from '../program/program.ts';
import type { CheckerContext } from './context.ts';

export interface UseSite {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
  readonly at: Span;
  readonly report: (diagnostic: Diagnostic) => void;
}

/** A use site reporting through its module's checker. */
export function useSite(checker: CheckerContext, module: ModuleId, at: Span): UseSite {
  return { checker, module, at, report: (diagnostic) => checker.report(module, diagnostic) };
}

/** The same site, reporting nothing. */
export function silent(site: UseSite): UseSite {
  return { ...site, report: () => undefined };
}
