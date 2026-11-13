/**
 * How a value's type fits the type a body expects of it (§2), reported where it doesn't: a closure
 * by what it captures where that is why (§3.14), as a trait it doesn't meet when an `any` type is
 * expected, else as a misfit, which also says when it converts into several members of a union. What doesn't fit then counts as fitting as it is, so
 * one mistake is reported once.
 */

import type { Expression } from '../../../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { bodySite } from '../../contexts/use-site.ts';
import { explainedCaptures } from '../../resolution/calls/captured-sends.ts';
import { reportUnmet } from '../../resolution/conformance/trait-objects.ts';
import type { ValueSite } from '../../surface/checked-body.ts';
import { exactFit, type Fit, misfitOf } from '../../types/fitting/fit/index.ts';
import type { Type } from '../../types/type/index.ts';

/** Where a misfit is reported: its span, and the value it is of, where one is. */
interface MisfitPlace {
  readonly at: AnchoredSpan;
  readonly site?: ValueSite | undefined;
}

/** How `found` fits `expected`; as it is after reporting at `place` why not. */
export function reportedFit(
  context: BodyContext,
  found: Type,
  expected: Type,
  place: MisfitPlace,
): Fit {
  const { checker } = context;
  const fit = checker.fitOf(found, expected);
  if (fit !== undefined) {
    return fit;
  }
  const { at, site } = place;
  if (isExpression(site) && explainedCaptures(context, site, expected)) {
    return exactFit;
  }
  if (expected.kind !== 'any' || !reportUnmet(bodySite(context, at), found, expected)) {
    context.report(misfitOf(checker.fitting, at, found, expected));
  }
  return exactFit;
}

/** Whether `site` is a value written as an expression, which a closure may be. */
function isExpression(site: ValueSite | undefined): site is Expression {
  return (
    site !== undefined && site.kind !== 'Return' && site.kind !== 'Block' && site.kind !== 'Spread'
  );
}
