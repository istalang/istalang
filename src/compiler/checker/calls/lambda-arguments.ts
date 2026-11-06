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

import { valueBranchesOf } from '../../syntax/expressions/branches.ts';
import type { Expression, Lambda } from '../../syntax/expressions/index.ts';
import { unparenthesized } from '../../syntax/expressions/readings.ts';
import { type Block, tailExpressionOf } from '../../syntax/statements.ts';
import type { BodyContext } from '../body-context.ts';
import type { Inference } from '../inference/infer.ts';
import type { Application } from '../resolution/choice.ts';
import { collectionTarget, expectedFunction, expectedTuple } from '../types/expected.ts';
import { parametersIn } from '../types/parts/type-parts.ts';
import type { Type } from '../types/type.ts';

/** An argument of a call being resolved: its node, and its type unless the call decides it. */
interface Argument {
  readonly node: Expression;
  readonly type: Type | undefined;
}

/**
 * Checks the lambdas among `written` that `application` decides, binding what their results give;
 * each checked lambda is recorded on `context.functions`, so `checkLambda` reuses its type when
 * `fitArguments` checks the enclosing argument.
 */
export function checkDecidedLambdas(
  context: BodyContext,
  written: readonly Argument[],
  application: Application,
): void {
  const { inference, slots } = application;
  written.forEach(({ node, type }, index) => {
    const slot = slots.get(index);
    if (type !== undefined || slot === undefined) {
      return;
    }
    inferNestedLambdas(context, node, slot.type, inference);
  });
}

/** Checks `node`, a lambda, against `expected` when its parameters are known, binding its result. */
function inferLambdaAt(
  context: BodyContext,
  node: Lambda,
  expected: Type,
  inference: Inference,
): void {
  const partial = expectedFunction(expected);
  if (
    partial === undefined ||
    partial.parameters.some((parameter) => isOpen(parameter.type, inference)) ||
    (partial.pack !== undefined && isOpen(partial.pack, inference))
  ) {
    return;
  }
  const checked = isOpen(partial.result, inference)
    ? context.inferLambda(node, partial)
    : context.expression(node, partial);
  inference.match(partial, checked);
}

/** Walks `node` and `expected` together, inferring any decided lambdas inside `node`. */
function inferNestedLambdas(
  context: BodyContext,
  node: Expression,
  expected: Type,
  inference: Inference,
): void {
  const bare = unparenthesized(node);
  const guide = inference.substituted(expected);
  switch (bare.kind) {
    case 'Lambda':
      inferLambdaAt(context, bare, guide, inference);
      return;
    case 'BlockExpression':
      inferBlockLambdas(context, bare.block, expected, inference);
      return;
    case 'If':
    case 'Match':
    case 'Select':
      for (const body of valueBranchesOf(bare)) {
        inferBlockLambdas(context, body, expected, inference);
      }
      return;
    case 'Tuple':
    case 'ArrayLiteral':
    case 'MapLiteral':
      for (const [part, type] of guidedParts(context, bare, guide)) {
        inferNestedLambdas(context, part, type, inference);
      }
      return;
    default:
      return;
  }
}

/** The parts of a tuple, array or map literal, each with the type `expected` asks of it. */
function guidedParts(
  context: BodyContext,
  node: Extract<Expression, { readonly kind: 'Tuple' | 'ArrayLiteral' | 'MapLiteral' }>,
  expected: Type,
): readonly (readonly [Expression, Type])[] {
  const { checker } = context;
  switch (node.kind) {
    case 'Tuple': {
      const elements = expectedTuple(expected, node.elements.length) ?? [];
      return node.elements.flatMap((element, index) => guided(element, elements[index]));
    }
    case 'ArrayLiteral': {
      const target = collectionTarget(checker, expected);
      const item = target?.kind === 'array' ? target.item : undefined;
      return node.elements.flatMap((element) =>
        element.kind === 'Spread' ? [] : guided(element, item),
      );
    }
    case 'MapLiteral': {
      const target = collectionTarget(checker, expected);
      const [key, value] = target?.kind === 'map' ? target.arguments : [];
      return node.entries.flatMap((entry) =>
        entry.kind === 'MapEntry' ? [...guided(entry.key, key), ...guided(entry.value, value)] : [],
      );
    }
    default: {
      const unhandled: never = node;
      return unhandled;
    }
  }
}

/** `part` with the type it is guided by, when it has one. */
function guided(
  part: Expression,
  type: Type | undefined,
): readonly (readonly [Expression, Type])[] {
  return type === undefined ? [] : [[part, type]];
}

function inferBlockLambdas(
  context: BodyContext,
  block: Block,
  expected: Type,
  inference: Inference,
): void {
  const tail = tailExpressionOf(block);
  if (tail !== undefined && block.statements.length === 1) {
    inferNestedLambdas(context, tail, expected, inference);
  }
}

/** Whether `type` mentions a type parameter `inference` is finding and hasn't bound. */
function isOpen(type: Type, inference: Inference): boolean {
  return parametersIn(type).some(
    (parameter) => inference.isUnknown(parameter) && inference.boundOf(parameter) === undefined,
  );
}
