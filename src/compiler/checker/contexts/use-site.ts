/**
 * Where something is used, for checks that report there: how they report, at the span the site
 * stands at, and whether values cross to the host there. What a check searches never depends on
 * where it is used (witnesses are coherent, §3.10); only crossing to the host spares a codec the
 * Sendable its traits imply (`toHost`). A search whose failure its caller reports as a whole, or
 * that can't fail, searches through a site that reports nothing, and whose instantiations it notes
 * for no check.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import type { ModuleId } from '../../program/program.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import { type Witnesses, witnessCallsOf } from '../surface/resolved-call.ts';
import { type Substitution, substitutionFor } from '../types/parts/substitution.ts';
import type { CheckerContext, Instantiable } from './context.ts';

export interface UseSite {
  readonly checker: CheckerContext;
  /** Reports the diagnostic `diagnosticAt` makes at the site's span; a silent site reports none. */
  readonly report: (diagnosticAt: (at: AnchoredSpan) => Diagnostic<AnchoredSpan>) => void;
  /**
   * Whether values cross to the host here, as JSON (§3.6, §9). Encodable and Decodable imply
   * Sendable because a value that goes through JSON and back is a copy, sent; a disposable host
   * type isn't sendable, since a copy would be a second handle to the one resource, but its own
   * host takes it back, so only its codecs matter here.
   */
  readonly toHost: boolean;
  /**
   * Notes that the instantiation made here gives `declaration` `typeArguments` and passes it
   * `witnesses`, each run instantiated with what it is passed for: every type `match` they reach
   * reduces for them (§3.17), checked with the site's module; a silent site notes none.
   */
  readonly instantiates: (
    declaration: Instantiable,
    typeArguments: Substitution,
    witnesses?: Witnesses,
  ) => void;
}

/** A use site at `at` in `module`, reporting through the module's checker. */
export function useSite(checker: CheckerContext, module: ModuleId, at: AnchoredSpan): UseSite {
  return {
    checker,
    report: (diagnosticAt) => checker.report(module, diagnosticAt(at)),
    toHost: false,
    instantiates: (declaration, typeArguments, witnesses = new Map()) => {
      checker.constrainLater(module, { kind: 'reduces', at, declaration, typeArguments });
      for (const witness of witnessCallsOf(witnesses)) {
        checker.constrainLater(module, {
          kind: 'reduces',
          at,
          declaration: witness.function,
          typeArguments: substitutionFor(witness.function.typeParameters, witness.typeArguments),
        });
      }
    },
  };
}

/** A site that only searches, reporting nothing. */
export function searchSite(checker: CheckerContext): UseSite {
  return { checker, report: () => undefined, toHost: false, instantiates: () => undefined };
}

/** The same site, where values cross to the host. */
export function hostSite(site: UseSite): UseSite {
  return { ...site, toHost: true };
}

/** The same site, reporting nothing. */
export function silent(site: UseSite): UseSite {
  return { ...site, report: () => undefined, instantiates: () => undefined };
}
