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

import { wellKnown } from '../../../language/well-known.ts';
import {
  casesOf,
  type Expression,
  type Lambda,
  selectCasesOf,
  unparenthesized,
} from '../../syntax/expressions/index.ts';
import { type Block, tailExpressionOf } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import type { Inference } from '../inference/infer.ts';
import { argumentSlotsOf } from '../resolution/binding.ts';
import type { Application } from '../resolution/choice.ts';
import { withoutOptionals } from '../types/fit.ts';
import { substitute } from '../types/substitution.ts';
import type { Type } from '../types/type.ts';
import { parametersIn } from '../types/type-parts.ts';
import { arrayElement, wellKnownArguments } from '../types/well-known.ts';

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
  const { signature, inference, binding } = application;
  const slots = argumentSlotsOf(signature.parameters, binding);
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
  const partial = withoutOptionals(
    substitute(expected, inference.substitution()),
    context.checker.optionalEntity,
  );
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
  const unwrapped = withoutOptionals(
    substitute(expected, inference.substitution()),
    context.checker.optionalEntity,
  );
  switch (bare.kind) {
    case 'Lambda':
      inferLambdaAt(context, bare, unwrapped, inference);
      return;
    case 'BlockExpression':
    case 'If':
    case 'Match':
    case 'Select':
      for (const body of branchBodiesOf(bare)) {
        inferBlockLambdas(context, body, expected, inference);
      }
      return;
    case 'Tuple':
      inferTupleLambdas(context, bare.elements, unwrapped, inference);
      return;
    case 'ArrayLiteral':
      inferArrayLambdas(context, bare.elements, unwrapped, inference);
      return;
    case 'MapLiteral':
      inferMapLambdas(context, bare.entries, unwrapped, inference);
      return;
    default:
      return;
  }
}

function branchBodiesOf(
  node: Extract<Expression, { readonly kind: 'BlockExpression' | 'If' | 'Match' | 'Select' }>,
): readonly Block[] {
  switch (node.kind) {
    case 'BlockExpression':
      return [node.block];
    case 'If': {
      const branches = node.branches.map(({ body }) => body);
      return node.elseClause === undefined ? branches : [...branches, node.elseClause.body];
    }
    case 'Match':
      return casesOf(node).map(({ body }) => body);
    case 'Select': {
      const cases = selectCasesOf(node).map(({ body }) => body);
      return node.elseClause === undefined ? cases : [...cases, node.elseClause.body];
    }
    default: {
      const unhandled: never = node;
      return unhandled;
    }
  }
}

function inferTupleLambdas(
  context: BodyContext,
  elements: readonly Expression[],
  unwrapped: Type,
  inference: Inference,
): void {
  if (unwrapped.kind !== 'tuple' || unwrapped.elements.length !== elements.length) {
    return;
  }
  elements.forEach((element, index) => {
    const guide = unwrapped.elements[index];
    if (guide !== undefined) {
      inferNestedLambdas(context, element, guide, inference);
    }
  });
}

function inferArrayLambdas(
  context: BodyContext,
  elements: Extract<Expression, { readonly kind: 'ArrayLiteral' }>['elements'],
  unwrapped: Type,
  inference: Inference,
): void {
  const item = arrayElement(context.checker, unwrapped);
  if (item === undefined) {
    return;
  }
  for (const element of elements) {
    if (element.kind !== 'Spread') {
      inferNestedLambdas(context, element, item, inference);
    }
  }
}

function inferMapLambdas(
  context: BodyContext,
  entries: Extract<Expression, { readonly kind: 'MapLiteral' }>['entries'],
  unwrapped: Type,
  inference: Inference,
): void {
  const [keyType, valueType] = wellKnownArguments(context.checker, wellKnown.map, unwrapped) ?? [];
  for (const entry of entries) {
    if (entry.kind === 'MapEntry') {
      if (keyType !== undefined) {
        inferNestedLambdas(context, entry.key, keyType, inference);
      }
      if (valueType !== undefined) {
        inferNestedLambdas(context, entry.value, valueType, inference);
      }
    }
  }
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
