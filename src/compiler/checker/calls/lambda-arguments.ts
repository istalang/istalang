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

let activeInferredLambdas: ReadonlyMap<Lambda, Type> | undefined;

/** The type `checkDecidedLambdas` already inferred for `node` in the current call; else undefined. */
export function inferredLambdaOf(node: Lambda): Type | undefined {
  return activeInferredLambdas?.get(node);
}

/** Runs `run` with `lambdas` visible to `checkLambda`, so decided lambdas aren't checked twice. */
export function withInferredLambdas(lambdas: ReadonlyMap<Lambda, Type>, run: () => void): void {
  const previous = activeInferredLambdas;
  activeInferredLambdas = lambdas;
  try {
    run();
  } finally {
    activeInferredLambdas = previous;
  }
}

/**
 * Checks the lambdas among `written` that `application` decides, binding what their results give;
 * their inferred types, by lambda node.
 */
export function checkDecidedLambdas(
  context: BodyContext,
  written: readonly Argument[],
  application: Application,
): ReadonlyMap<Lambda, Type> {
  const { signature, inference, binding } = application;
  const slots = argumentSlotsOf(signature.parameters, binding);
  const inferred = new Map<Lambda, Type>();
  written.forEach(({ node, type }, index) => {
    const slot = slots.get(index);
    if (type !== undefined || slot === undefined) {
      return;
    }
    inferNestedLambdas(context, node, slot.type, { inference, inferred });
  });
  return inferred;
}

interface LambdaInference {
  readonly inference: Inference;
  readonly inferred: Map<Lambda, Type>;
}

/** Checks `node`, a lambda, against `expected` when its parameters are known, binding its result. */
function inferLambdaAt(
  context: BodyContext,
  node: Lambda,
  expected: Type,
  { inference, inferred }: LambdaInference,
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
  inferred.set(node, checked);
}

/** Walks `node` and `expected` together, inferring any decided lambdas inside `node`. */
function inferNestedLambdas(
  context: BodyContext,
  node: Expression,
  expected: Type,
  state: LambdaInference,
): void {
  const bare = unparenthesized(node);
  const unwrapped = withoutOptionals(
    substitute(expected, state.inference.substitution()),
    context.checker.optionalEntity,
  );
  switch (bare.kind) {
    case 'Lambda':
      inferLambdaAt(context, bare, unwrapped, state);
      return;
    case 'BlockExpression':
    case 'If':
    case 'Match':
    case 'Select':
      for (const body of branchBodiesOf(bare)) {
        inferBlockLambdas(context, body, expected, state);
      }
      return;
    case 'Tuple':
      inferTupleLambdas(context, bare.elements, unwrapped, state);
      return;
    case 'ArrayLiteral':
      inferArrayLambdas(context, bare.elements, unwrapped, state);
      return;
    case 'MapLiteral':
      inferMapLambdas(context, bare.entries, unwrapped, state);
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
      const cases = node.cases.flatMap((each) => (each.kind === 'SelectCase' ? [each.body] : []));
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
  state: LambdaInference,
): void {
  if (unwrapped.kind !== 'tuple' || unwrapped.elements.length !== elements.length) {
    return;
  }
  elements.forEach((element, index) => {
    const guide = unwrapped.elements[index];
    if (guide !== undefined) {
      inferNestedLambdas(context, element, guide, state);
    }
  });
}

function inferArrayLambdas(
  context: BodyContext,
  elements: Extract<Expression, { readonly kind: 'ArrayLiteral' }>['elements'],
  unwrapped: Type,
  state: LambdaInference,
): void {
  const item = arrayElement(context.checker, unwrapped);
  if (item === undefined) {
    return;
  }
  for (const element of elements) {
    if (element.kind !== 'Spread') {
      inferNestedLambdas(context, element, item, state);
    }
  }
}

function inferMapLambdas(
  context: BodyContext,
  entries: Extract<Expression, { readonly kind: 'MapLiteral' }>['entries'],
  unwrapped: Type,
  state: LambdaInference,
): void {
  const [keyType, valueType] = wellKnownArguments(context.checker, wellKnown.map, unwrapped) ?? [];
  for (const entry of entries) {
    if (entry.kind === 'MapEntry') {
      if (keyType !== undefined) {
        inferNestedLambdas(context, entry.key, keyType, state);
      }
      if (valueType !== undefined) {
        inferNestedLambdas(context, entry.value, valueType, state);
      }
    }
  }
}

function inferBlockLambdas(
  context: BodyContext,
  block: Block,
  expected: Type,
  state: LambdaInference,
): void {
  const tail = tailExpressionOf(block);
  if (tail !== undefined && block.statements.length === 1) {
    inferNestedLambdas(context, tail, expected, state);
  }
}

/** Whether `type` mentions a type parameter `inference` is finding and hasn't bound. */
function isOpen(type: Type, inference: Inference): boolean {
  return parametersIn(type).some(
    (parameter) => inference.isUnknown(parameter) && inference.boundOf(parameter) === undefined,
  );
}
