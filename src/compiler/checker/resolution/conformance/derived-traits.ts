/**
 * The traits the compiler derives (§3.1, §3.10): met by a rule over what a type is, where no
 * function declared for it meets them. Conformance consults this one table for every constraint
 * (conformance.ts) rather than testing for each trait. Each rule decides by the kind of type it is
 * given (traits/sendable.ts, rules/boundary/json-forms.ts), so a new kind of type is one case in
 * each rule and nothing here or in conformance.
 *
 * - `Sendable` requires no function, so its rule is all there is to meeting it.
 * - `Encodable` and `Decodable` each imply Sendable, since JSON written and read back is a copy
 *   sent, except where values cross to the host, which a disposable host type does unsendable
 *   (use-site.ts). A type declaring no codec of its own is met by the one the compiler derives
 *   from its JSON form.
 */

import { type WellKnownDeclaration, wellKnown } from '../../../../language/well-known.ts';
import type { TraitDeclaration } from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../context.ts';
import { type DerivedCodec, type JsonDirection, jsonTraits } from '../../surface/json-form.ts';
import { isSendable } from '../../traits/sendable.ts';
import type { Type } from '../../types/type/index.ts';
import { isWellKnownTrait } from '../../types/well-known.ts';
import type { UseSite } from '../../use-site.ts';

/** How a derived trait is met: what it asks of every type, and what it derives for one. */
export interface Derivation {
  /**
   * What `type` lacks to meet the trait at `site`, whatever functions are declared for it, in
   * words a diagnostic finishes ("it needs …"); undefined when nothing.
   */
  readonly lacking: (site: UseSite, type: Type) => string | undefined;
  /**
   * The witness of the trait's function derived for `type`, which declares none, or what `type`
   * lacks to have one; absent for a trait requiring no function.
   */
  readonly derive?: (site: UseSite, type: Type) => DerivedCodec;
}

/** What `type` lacks to be sendable; undefined when it is. */
function unsendable(site: UseSite, type: Type): string | undefined {
  return isSendable(site.checker, type) ? undefined : 'every value inside it to be sendable';
}

/** The derivation of the trait a value crosses as JSON by in `direction`. */
function codecDerivation(direction: JsonDirection): Derivation {
  return {
    lacking: (site, type) => (site.toHost ? undefined : unsendable(site, type)),
    derive: (site, type) => site.checker.json.derivedOf(site, type, direction),
  };
}

/** Each derived trait, by its declaration, with how it is derived. */
const derivations: ReadonlyMap<WellKnownDeclaration, Derivation> = new Map<
  WellKnownDeclaration,
  Derivation
>([
  [wellKnown.sendable, { lacking: unsendable }],
  [jsonTraits.write, codecDerivation('write')],
  [jsonTraits.read, codecDerivation('read')],
]);

/** How `trait` is derived; undefined for a trait met by declared functions alone. */
export function derivationOf(
  checker: CheckerContext,
  trait: TraitDeclaration,
): Derivation | undefined {
  for (const [declaration, derivation] of derivations) {
    if (isWellKnownTrait(checker, trait, declaration)) {
      return derivation;
    }
  }
  return undefined;
}
