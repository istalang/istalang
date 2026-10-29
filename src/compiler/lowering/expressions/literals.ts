/**
 * Literals whose type a std module declares: a duration literal is a `time.Duration` struct of its
 * milliseconds (§2), the same value as a constant (`durationForm`), so it lowers to a constant.
 */

import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { durationForm } from '../../checker/constant-form.ts';
import type { DurationLiteral } from '../../syntax/expressions/index.ts';
import { constantValue } from '../constants.ts';
import type { FunctionContext } from '../context.ts';

export function lowerDurationLiteral(context: FunctionContext, node: DurationLiteral): Register {
  const type = context.typeOf(node);
  if (type.kind !== 'nominal') {
    unreachable(
      `A duration at ${node.span.from} isn't a Duration; the checker should have said so.`,
    );
  }
  const form = durationForm(type, node.value);
  return context.constant(constantValue(context.tables, form), node.span);
}
