/**
 * Literals whose type is declared in a std module: a duration literal is sugar for the `time`
 * module's `Duration` (§2), which every program loads without importing it, so a literal works in
 * any module while the name `Duration` is visible only where imported.
 */

import type { DurationLiteral } from '../../syntax/expressions.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { errorType, type Type } from '../types/type.ts';

export function checkDurationLiteral(context: BodyContext, node: DurationLiteral): Type {
  const duration = context.checker.languageType('time', 'Duration');
  if (duration === undefined) {
    context.report(checkerDiagnostics.missingStdModule(node.span, 'time'));
    return errorType;
  }
  return duration;
}
