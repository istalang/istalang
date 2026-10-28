/**
 * Lambdas passed as arguments (§3.5, §3.14). A lambda with an untyped parameter takes its types
 * from the parameter it is passed to, so the call decides it, as it decides `none`: choosing a
 * function looks only at whether the lambda's shape can fit (resolution/choice.ts).
 *
 * Once a function is chosen, such a lambda is checked after the other arguments, which have bound
 * what they can of the type parameters, and before the call is instantiated: its parameter types
 * come from there, and what its body produces binds the type parameters of its result, as
 * `xs.map(fn x: x * 2)` binds `U` from `x * 2`: a result nothing has bound is left for the body
 * to decide (`BodyContext.inferLambda`). A lambda whose parameter types still mention a type
 * parameter nothing has bound is left for instantiating to report.
 */

import { type Expression, unparenthesized } from '../../syntax/expressions/index.ts';
import type { BodyContext } from '../context.ts';
import type { Inference } from '../inference/infer.ts';
import { argumentSlotsOf } from '../resolution/binding.ts';
import type { Application } from '../resolution/choice.ts';
import { substitute } from '../types/substitution.ts';
import type { Type } from '../types/type.ts';
import { parametersIn } from '../types/type-parts.ts';

/** An argument of a call being resolved: its node, and its type unless the call decides it. */
interface Argument {
  readonly node: Expression;
  readonly type: Type | undefined;
}

/**
 * Checks the lambdas among `written` that `application` decides, binding what their results give;
 * their types, by argument position.
 */
export function checkDecidedLambdas(
  context: BodyContext,
  written: readonly Argument[],
  application: Application,
): ReadonlyMap<number, Type> {
  const { signature, inference, binding } = application;
  const slots = argumentSlotsOf(signature.parameters, binding);
  const types = new Map<number, Type>();
  written.forEach(({ node, type }, index) => {
    const slot = slots.get(index);
    if (type !== undefined || slot === undefined || unparenthesized(node).kind !== 'Lambda') {
      return;
    }
    const partial = substitute(slot.type, inference.substitution());
    if (
      partial.kind !== 'function' ||
      partial.parameters.some((parameter) => isOpen(parameter.type, inference)) ||
      (partial.pack !== undefined && isOpen(partial.pack, inference))
    ) {
      return;
    }
    const checked = isOpen(partial.result, inference)
      ? context.inferLambda(node, partial)
      : context.expression(node, partial);
    inference.match(slot.type, checked);
    types.set(index, checked);
  });
  return types;
}

/** Whether `type` mentions a type parameter `inference` is finding and hasn't bound. */
function isOpen(type: Type, inference: Inference): boolean {
  return parametersIn(type).some(
    (parameter) => inference.isUnknown(parameter) && inference.boundOf(parameter) === undefined,
  );
}
