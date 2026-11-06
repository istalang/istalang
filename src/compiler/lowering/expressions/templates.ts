/**
 * Templates (§2). An untagged template writes each value as text with the `toString` the checker
 * chose, in order, and joins its texts and those with the prelude's `join`, the texts that are
 * empty left out; one without values is its text. A tagged template is the call it stands for
 * (syntax/expressions/literals/templates.ts), lowered as any written call is.
 */

import type { Register } from '../../../definition/operands.ts';
import type { TemplateLiteral } from '../../syntax/expressions/index.ts';
import {
  constantTextOf,
  isTagged,
  taggedCall,
} from '../../syntax/expressions/literals/templates.ts';
import { emitImplicitCall } from '../calls/emit-call.ts';
import type { FunctionContext } from '../context.ts';

export function lowerTemplate(context: FunctionContext, node: TemplateLiteral): Register {
  if (isTagged(node)) {
    return context.expression(taggedCall(node));
  }
  const constantText = constantTextOf(node);
  if (constantText !== undefined) {
    return context.constant(constantText, node.span);
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
