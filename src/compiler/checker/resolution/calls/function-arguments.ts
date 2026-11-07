/**
 * Functions passed as arguments whose types the call decides (§3.5, §3.14): a lambda with an
 * untyped parameter takes its types from the parameter it is passed to, and a generic function or
 * a set of overloads named as a value is chosen by them, so the call decides it, as it decides
 * `none`: choosing a function looks only at whether such an argument can fit
 * (resolution/choosing/choice.ts).
 *
 * Once a function is chosen, such an argument is judged after the other arguments, which have
 * bound what they can of the type parameters, and before the call is instantiated: its parameter
 * types come from there, and what it gives binds the type parameters of its result, as
 * `xs.map(fn x: x * 2)` binds `U` from `x * 2` and `xs.map(Result.Ok)` from `Ok`'s result. A
 * lambda's result nothing has bound is left for its body to decide (`BodyContext.inferLambda`); a
 * named function is chosen and instantiated without its result (`functionValueType`), which
 * records nothing, so the argument is checked once, against the parameter's type, when the
 * arguments are fitted. One whose parameter types still mention a type parameter nothing has
 * bound is left for instantiating to report.
 */

import { valueBranchesOf } from '../../../syntax/expressions/branches.ts';
import type { Expression, Lambda, MemberAccess } from '../../../syntax/expressions/index.ts';
import { unparenthesized } from '../../../syntax/expressions/readings.ts';
import type { Block } from '../../../syntax/statements/index.ts';
import { tailExpressionOf } from '../../../syntax/statements/readings.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { collectionTarget, expectedFunction, expectedTuple } from '../../types/fitting/expected.ts';
import type { Inference } from '../../types/inference/infer.ts';
import { parametersIn } from '../../types/parts/type-parts.ts';
import type { FunctionType, Type } from '../../types/type/index.ts';
import type { Application } from '../choosing/choice.ts';
import { functionValueType } from '../choosing/named-functions.ts';

/** An argument of a call being resolved: its node, and its type unless the call decides it. */
interface Argument {
  readonly node: Expression;
  readonly type: Type | undefined;
}

/**
 * Judges the functions among `written` that `application` decides, binding what their results
 * give; each checked lambda is recorded on `context.functions`, so `checkLambda` reuses its type
 * when `fitArguments` checks the enclosing argument.
 */
export function checkDecidedFunctions(
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
    inferNestedFunctions(context, node, slot.type, inference);
  });
}

/**
 * Checks `node`, a lambda, against `expected` when its parameters are known, binding its result.
 */
function inferLambdaAt(
  context: BodyContext,
  node: Lambda,
  expected: Type,
  inference: Inference,
): void {
  const partial = knownParameters(expected, inference);
  if (partial === undefined) {
    return;
  }
  const checked = isOpen(partial.result, inference)
    ? context.inferLambda(node, partial)
    : context.expression(node, partial);
  inference.match(partial, checked);
}

/**
 * Binds what the function `node` names gives when its parameters are known and its result isn't,
 * choosing it by them; a name of anything else, or with nothing to bind, is left to fitting.
 */
function inferNamedAt(
  context: BodyContext,
  node: Identifier | MemberAccess,
  expected: Type,
  inference: Inference,
): void {
  const partial = knownParameters(expected, inference);
  if (partial === undefined || !isOpen(partial.result, inference)) {
    return;
  }
  const type = functionValueType(context, node, partial);
  if (type !== undefined) {
    inference.match(partial, type);
  }
}

/** The function type `expected` is, when inference has found all of its parameters' types. */
function knownParameters(expected: Type, inference: Inference): FunctionType | undefined {
  const partial = expectedFunction(expected);
  return partial === undefined ||
    partial.parameters.some((parameter) => isOpen(parameter.type, inference)) ||
    (partial.pack !== undefined && isOpen(partial.pack, inference))
    ? undefined
    : partial;
}

/** Walks `node` and `expected` together, inferring any decided functions inside `node`. */
function inferNestedFunctions(
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
    case 'Identifier':
    case 'MemberAccess':
      inferNamedAt(context, bare, guide, inference);
      return;
    case 'BlockExpression':
      inferBlockFunctions(context, bare.block, expected, inference);
      return;
    case 'If':
    case 'Match':
    case 'Select':
      for (const body of valueBranchesOf(bare)) {
        inferBlockFunctions(context, body, expected, inference);
      }
      return;
    case 'Tuple':
    case 'ArrayLiteral':
    case 'MapLiteral':
      for (const [part, type] of guidedParts(context, bare, guide)) {
        inferNestedFunctions(context, part, type, inference);
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

function inferBlockFunctions(
  context: BodyContext,
  block: Block,
  expected: Type,
  inference: Inference,
): void {
  const tail = tailExpressionOf(block);
  if (tail !== undefined && block.statements.length === 1) {
    inferNestedFunctions(context, tail, expected, inference);
  }
}

/** Whether `type` mentions a type parameter `inference` is finding and hasn't bound. */
function isOpen(type: Type, inference: Inference): boolean {
  return parametersIn(type).some(
    (parameter) => inference.isUnknown(parameter) && inference.boundOf(parameter) === undefined,
  );
}
