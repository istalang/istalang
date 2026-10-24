/**
 * Literals whose type a std module declares: a duration literal is a `time.Duration` struct of its
 * milliseconds (§2), built like any struct of that type.
 */

import type { Register } from '../../../definition/operands.ts';
import type { DurationLiteral } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';
import { nominalTypeOf } from './structs.ts';

export function lowerDurationLiteral(context: FunctionContext, node: DurationLiteral): Register {
  const milliseconds = context.constant(node.value, node.span);
  const dst = context.code.allocate();
  context.code.emit({
    kind: 'struct',
    span: node.span,
    dst,
    type: context.tables.typeIndex(nominalTypeOf(context, node)),
    fields: [milliseconds],
  });
  return dst;
}
