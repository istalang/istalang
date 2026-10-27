/**
 * Templates (§2). An untagged template writes each value as text with the `toString` the checker
 * chose, in order, and joins its texts and those with the prelude's `join`, the texts that are
 * empty left out; one without values is its text. A tagged template is the call it stands for
 * (syntax/expressions/templates.ts), lowered as any written call is.
 */

import type { Register } from '../../../definition/operands.ts';
import type { TemplateLiteral } from '../../syntax/expressions/index.ts';
import { taggedCall } from '../../syntax/expressions/templates.ts';
import type { FunctionContext } from '../context.ts';
import { emitImplicitCall } from '../emit-call.ts';

export function lowerTemplate(context: FunctionContext, node: TemplateLiteral): Register {
  if (node.tag !== undefined) {
    return context.expression(taggedCall(node, node.tag));
  }
  if (node.values.length === 0) {
    return context.constant(node.texts[0]?.value ?? '', node.span);
  }
  const parts = node.texts.flatMap((text, index) => {
    const written =
      text.value === ''
        ? []
        : [{ kind: 'item', value: context.constant(text.value, text.span) } as const];
    const value = node.values[index];
    if (value === undefined) {
      return written;
    }
    const register = emitImplicitCall(context, value, 'interpolate', [context.expression(value)]);
    return [...written, { kind: 'item', value: register } as const];
  });
  const joined = context.code.allocate();
  context.code.emit({ kind: 'array', span: node.span, dst: joined, elements: parts });
  const separator = context.constant('', node.span);
  return emitImplicitCall(context, node, 'join', [joined, separator]);
}
