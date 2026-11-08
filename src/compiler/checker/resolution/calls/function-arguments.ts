/**
 * Functions passed as arguments whose types the call decides (§3.5, §3.14): a lambda with an
 * untyped parameter takes its types from the parameter it is passed to, and a generic function or
 * a set of overloads named as a value is chosen by them, so the call decides it: choosing a
 * function looks only at whether such an argument can fit (resolution/choosing/choice.ts).
 *
 * Once a function is chosen and the expected type has given its bounds, each such argument is
 * postponed until the type parameters its parameter's inputs mention are settled (Kotlin's
 * postponed arguments): an argument whose inputs another one's result bounds waits for that one.
 * Its inputs are then settled and fixed (types/inference/settle.ts), and its result is checked
 * against what is known of the parameter's: where a type parameter there is still open, the
 * expected type's choice for it, as settling's rule 2 would take it (`Inference.guided`), guides
 * the body as its expected type, never as the lambda's declared result, so `vs.map(fn x: Ok(x))`
 * as an `Array<Result<Int, String>>` gives `Ok` its `E` while the lambda gives what its body does.
 * What it then gives bounds the type parameters of its result, as `xs.map(fn x: x * 2)` bounds `U`
 * by `x * 2`. A lambda's body decides its result (`BodyContext.inferLambda`); a named function is chosen and instantiated
 * against what is known of its result (`functionValueType`), which records nothing, so the
 * argument is checked once, against the parameter's type, when the arguments are fitted. One whose
 * inputs stay open is left for instantiating to report, but a lone function, whose whole type
 * bounds them.
 */

import { valueBranchesOf } from '../../../syntax/expressions/branches.ts';
import type { Expression, Lambda } from '../../../syntax/expressions/index.ts';
import { unparenthesized } from '../../../syntax/expressions/readings.ts';
import type { Block } from '../../../syntax/statements/index.ts';
import { tailExpressionOf } from '../../../syntax/statements/readings.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { collectionTarget, expectedFunction, expectedTuple } from '../../types/fitting/expected.ts';
import type { Inference } from '../../types/inference/infer.ts';
import type { Settling } from '../../types/inference/settle.ts';
import { typeChildren } from '../../types/parts/type-children.ts';
import { parametersIn } from '../../types/parts/type-parts.ts';
import type { FunctionType, ParameterKey, Type } from '../../types/type/index.ts';
import type { Application } from '../choosing/choice.ts';
import { type FunctionNaming, functionValueType } from '../choosing/named-functions.ts';

/** An argument of a call being resolved: its node, and its type unless the call decides it. */
interface Argument {
  readonly node: Expression;
  readonly type: Type | undefined;
}

/** An argument the chosen function decides, with the type of the parameter it fills. */
interface Postponed {
  readonly node: Expression;
  readonly declared: Type;
}

/** What judging a postponed argument reads: the call's inference, and how its parameters settle. */
interface Judging {
  readonly inference: Inference;
  readonly settling: Settling;
}

/**
 * Judges the functions among `written` that `application` decides, each once the type parameters
 * its inputs mention are settled, bounding what their results give; each checked lambda is
 * recorded on `context.functions`, so `checkLambda` reuses its type when `fitArguments` checks the
 * enclosing argument.
 */
export function checkDecidedFunctions(
  context: BodyContext,
  written: readonly Argument[],
  application: Application,
  settling: Settling,
): void {
  const { inference, slots } = application;
  const pending: Postponed[] = written.flatMap(({ node, type }, index) => {
    const slot = slots.get(index);
    return type !== undefined || slot === undefined ? [] : [{ node, declared: slot.type }];
  });
  while (pending.length > 0) {
    const ready = pending.findIndex((argument) =>
      inputsOf(argument.declared).every(
        (input) =>
          !pending.some((other) => other !== argument && outputsOf(other.declared).includes(input)),
      ),
    );
    const [next] = pending.splice(Math.max(0, ready), 1);
    if (next !== undefined) {
      inferNestedFunctions(context, next.node, next.declared, { inference, settling });
    }
  }
}

/**
 * The type parameters a value of `type` needs settled before it can be checked: those of a
 * function's parameters, and those anywhere outside a function's result.
 */
function inputsOf(type: Type): readonly ParameterKey[] {
  const shape = expectedFunction(type);
  if (shape === undefined) {
    const children = typeChildren(type);
    return children.length === 0 ? parametersIn(type) : children.flatMap(inputsOf);
  }
  return [
    ...shape.parameters.flatMap((parameter) => parametersIn(parameter.type)),
    ...(shape.pack === undefined ? [] : parametersIn(shape.pack)),
    ...(expectedFunction(shape.result) === undefined ? [] : inputsOf(shape.result)),
  ];
}

/** The type parameters a value of `type` gives: those of its functions' results. */
function outputsOf(type: Type): readonly ParameterKey[] {
  const shape = expectedFunction(type);
  if (shape === undefined) {
    return typeChildren(type).flatMap(outputsOf);
  }
  return expectedFunction(shape.result) === undefined
    ? parametersIn(shape.result)
    : outputsOf(shape.result);
}

/**
 * Checks `node`, a lambda, where `expected` is taken, once its inputs are settled: against its
 * whole type where its result is known; else its body guided by what the call's expected type
 * says of the result (`Inference.guided`), its result its body's own; bounds what it gives.
 */
function inferLambdaAt(context: BodyContext, node: Lambda, expected: Type, judging: Judging): void {
  const shape = settledShape(expected, judging);
  if (shape === undefined) {
    return;
  }
  const { inference, settling } = judging;
  if (!isOpen(shape.result, inference)) {
    inference.match(expected, context.expression(node, shape));
    return;
  }
  const guide = inference.guided(shape.result, settling);
  const checked = context.inferLambda(node, shape, isOpen(guide, inference) ? undefined : guide);
  inference.match(expected, checked);
}

/**
 * Bounds what the function `node` names gives: chosen by the parameters `expected` gives, once
 * they are settled and while its result isn't known, its result guided by the expected type; else,
 * nothing giving them, a lone function's whole type, so a function with defaults passed to `T` is
 * its whole self. A name of anything else, or with nothing to bound, is left to fitting.
 */
function inferNamedAt(
  context: BodyContext,
  node: FunctionNaming,
  expected: Type,
  judging: Judging,
): void {
  const { inference } = judging;
  const shape = settledShape(expected, judging);
  if (shape !== undefined && !isOpen(shape.result, inference)) {
    return;
  }
  const guidedShape =
    shape === undefined
      ? undefined
      : { ...shape, result: inference.guided(shape.result, judging.settling) };
  const open = (part: Type) => isOpen(part, inference);
  const type = functionValueType(context, node, guidedShape, open);
  if (type !== undefined) {
    inference.match(expected, type);
  }
}

/**
 * The function type `expected` is, its parameters' type parameters settled and fixed, when they
 * are all known; its result as found so far.
 */
function settledShape(expected: Type, { inference, settling }: Judging): FunctionType | undefined {
  const shape = expectedFunction(expected);
  if (shape === undefined) {
    return undefined;
  }
  inference.fix(
    [...inputsOf(shape)].filter((parameter) => inference.isUnknown(parameter)),
    settling,
  );
  const known = expectedFunction(inference.settledIn(expected));
  return known === undefined ||
    known.parameters.some((parameter) => isOpen(parameter.type, inference)) ||
    (known.pack !== undefined && isOpen(known.pack, inference))
    ? undefined
    : known;
}

/** Walks `node` and `expected` together, inferring any decided functions inside `node`. */
function inferNestedFunctions(
  context: BodyContext,
  node: Expression,
  expected: Type,
  judging: Judging,
): void {
  const bare = unparenthesized(node);
  switch (bare.kind) {
    case 'Lambda':
      inferLambdaAt(context, bare, expected, judging);
      return;
    case 'Identifier':
    case 'MemberAccess':
    case 'TypeApplication':
      inferNamedAt(context, bare, expected, judging);
      return;
    case 'BlockExpression':
      inferBlockFunctions(context, bare.block, expected, judging);
      return;
    case 'If':
    case 'Match':
    case 'Select':
      for (const body of valueBranchesOf(bare)) {
        inferBlockFunctions(context, body, expected, judging);
      }
      return;
    case 'Tuple':
    case 'ArrayLiteral':
    case 'MapLiteral':
      for (const [part, type] of guidedParts(context, bare, expected)) {
        inferNestedFunctions(context, part, type, judging);
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
  judging: Judging,
): void {
  const tail = tailExpressionOf(block);
  if (tail !== undefined && block.statements.length === 1) {
    inferNestedFunctions(context, tail, expected, judging);
  }
}

/** Whether `type` mentions a type parameter `inference` is finding and hasn't settled. */
function isOpen(type: Type, inference: Inference): boolean {
  return parametersIn(inference.settledIn(type)).some((parameter) =>
    inference.isUnknown(parameter),
  );
}
