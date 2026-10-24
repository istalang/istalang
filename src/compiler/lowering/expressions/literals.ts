/**
 * Literals whose type a std module declares: a duration literal is a `time.Duration` struct of its
 * milliseconds (§2), the same value as a constant (`durationForm`), so it lowers to a constant.
 */

import type { Register } from '../../../definition/operands.ts';
import { durationForm } from '../../checker/constant-form.ts';
import type { DurationLiteral } from '../../syntax/expressions.ts';
import { constantValue } from '../constants.ts';
import type { FunctionContext } from '../context.ts';
import { nominalTypeOf } from './structs.ts';

export function lowerDurationLiteral(context: FunctionContext, node: DurationLiteral): Register {
  const form = durationForm(nominalTypeOf(context.body, node), node.value);
  return context.constant(constantValue(context.tables, form), node.span);
}
