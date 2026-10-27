/**
 * Where something is used, for checks that report there: how they report, at the span the site
 * stands at, and whether values cross to the host there. What a check searches never depends on
 * where it is used (witnesses are coherent, §3.10); only crossing to the host spares a codec the
 * Sendable its traits imply (`toHost`). A search whose failure its caller reports as a whole, or
 * that can't fail, searches through a site that reports nothing.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { Span } from '../../text/span.ts';
import type { ModuleId } from '../program/program.ts';
import type { CheckerContext } from './context.ts';

export interface UseSite {
  readonly checker: CheckerContext;
  /** Reports the diagnostic `diagnosticAt` makes at the site's span; a silent site reports none. */
  readonly report: (diagnosticAt: (at: Span) => Diagnostic) => void;
  /**
   * Whether values cross to the host here, as JSON (§3.6, §9). Encodable and Decodable imply
   * Sendable because a value that goes through JSON and back is a copy, sent; a disposable host
   * type isn't sendable, since a copy would be a second handle to the one resource, but its own
   * host takes it back, so only its codecs matter here.
   */
  readonly toHost: boolean;
}

/** A use site at `at` in `module`, reporting through the module's checker. */
export function useSite(checker: CheckerContext, module: ModuleId, at: Span): UseSite {
  return {
    checker,
    report: (diagnosticAt) => checker.report(module, diagnosticAt(at)),
    toHost: false,
  };
}

/** A site that only searches, reporting nothing. */
export function searchSite(checker: CheckerContext): UseSite {
  return { checker, report: () => undefined, toHost: false };
}

/** The same site, where values cross to the host. */
export function hostSite(site: UseSite): UseSite {
  return { ...site, toHost: true };
}

/** The same site, reporting nothing. */
export function silent(site: UseSite): UseSite {
  return { ...site, report: () => undefined };
}
