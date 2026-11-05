/**
 * Running over a struct's fields (§4): a field loop, an array comprehension and a struct
 * comprehension each check their subject once, then what their header heads once per pass over
 * its fields (traits/struct-keys.ts `fieldPassesOver`), the header's key and value taking apart the
 * pair of the pass's key and value. A subject with no fields to visit is reported, and what the
 * header heads checked once with nothing known of them, so each mistake in it is still found.
 */

import type { FieldHeader } from '../../syntax/expressions/index.ts';
import type { BodyContext, CheckedPasses } from '../body-context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { FieldPassType } from '../passes.ts';
import { declareTargets } from '../patterns/targets.ts';
import { fieldPassesOver } from '../traits/struct-keys.ts';
import { errorType, tupleType } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

/** The passes over the fields of `header`'s subject, which this checks. */
export function checkedFieldPasses(
  context: BodyContext,
  header: FieldHeader,
): readonly FieldPassType[] {
  const subject = context.expression(header.subject);
  const passes = fieldPassesOver(context.checker, subject, header);
  if (passes === undefined && subject.kind !== 'error') {
    context.report(checkerDiagnostics.fieldLoopSubject(header.subject.span, typeText(subject)));
  }
  return passes ?? [{ visits: { kind: 'none' }, key: errorType, value: errorType }];
}

/** Runs `each` once per pass of `passes`, `header`'s key and value bound to the pass's. */
export function inFieldPasses(
  context: BodyContext,
  header: FieldHeader,
  passes: readonly FieldPassType[],
  each: (pass: FieldPassType) => void,
): CheckedPasses {
  return context.fieldPasses(header, passes, (pass) => {
    declareTargets(context, header, tupleType([pass.key, pass.value]));
    each(pass);
  });
}
