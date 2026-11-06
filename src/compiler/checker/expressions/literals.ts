/**
 * Literals whose type is declared in a std module: a duration literal is sugar for the `time`
 * module's `Duration` (§2), which every program loads without importing it, so a literal works in
 * any module while the name `Duration` is visible only where imported.
 */

import { wellKnown } from '../../../language/well-known.ts';
import type { DurationLiteral } from '../../syntax/expressions/literals/literals.ts';
import type { BodyContext } from '../body-context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { Type } from '../types/type/index.ts';
import { errorType } from '../types/type/primitives.ts';

export function checkDurationLiteral(context: BodyContext, node: DurationLiteral): Type {
  const duration = context.checker.wellKnownType(wellKnown.duration);
  if (duration === undefined) {
    context.report(checkerDiagnostics.missingStdModule(node.span, wellKnown.duration.module));
    return errorType;
  }
  return duration;
}
