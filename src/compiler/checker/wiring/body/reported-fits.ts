/**
 * How a value's type fits the type a body expects of it (§2), reported where it doesn't: as a
 * trait it doesn't meet when an `any` type is expected, else as a misfit, which also says when it
 * converts into several members of a union. What doesn't fit then counts as fitting as it is, so
 * one mistake is reported once.
 */

import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { bodySite } from '../../contexts/use-site.ts';
import { reportUnmet } from '../../resolution/conformance/trait-objects.ts';
import { exactFit, type Fit, misfitOf } from '../../types/fitting/fit/index.ts';
import type { Type } from '../../types/type/index.ts';

/** How `found` fits `expected`; as it is after reporting at `at` why not. */
export function reportedFit(
  context: Pick<BodyContext, 'checker' | 'module' | 'report' | 'codeKind'>,
  found: Type,
  expected: Type,
  at: AnchoredSpan,
): Fit {
  const { checker } = context;
  const fit = checker.fitOf(found, expected);
  if (fit !== undefined) {
    return fit;
  }
  const site = bodySite(context, at);
  if (expected.kind !== 'any' || !reportUnmet(site, found, expected)) {
    context.report(misfitOf(checker.fitting, at, found, expected));
  }
  return exactFit;
}
