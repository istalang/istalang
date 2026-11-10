/**
 * Calls (docs/arch/definition.md, "Calls"): every call targets the function-table entry of the
 * function the checker resolved for its site, operators and compound assignments included, or the
 * one it made for a construct with no call written (indexing writes, loops, map literals of other
 * types). Every call is written by emit-call.ts.
 *
 * An argument written `&x` passes the place `x`; a method's receiver is its first argument,
 * passed as a place when its `self` takes a reference (§3.7), which the `&` left implicit. A place
 * reached through an element or a shared struct's value (`*x`) is copied in before the call and
 * written back after it (places.ts).
 *
 * Arguments are evaluated in the order written, named ones included (§3.3), and passed numbered as
 * the checker's binding numbers them. A spread an array's rest parameter collects gives its items
 * as an array where it stands, so a cursor it runs runs in the order written; emit-call then makes
 * the rest parameter of what is passed, an array or a pack's elements (§3.5).
 *
 * A call the checker recorded as a call of a function value (§3.14, `CheckedBody.valueCalls`)
 * calls its callee's value, the closure, and each argument is passed as written, which the
 * checker matched to the closure's parameters.
 *
 * A call of a variant's constructor builds the variant where it stands (emit-call.ts), and
 * `Expired()`, naming a variant without fields, is that variant's value (§3.11).
 *
 * A deferred call's taker is prepared as a call is, its taker's parts computed where it stands
 * (deferred-calls.ts, §3.14).
 */

import type { Argument } from '../../../../definition/instructions/places.ts';
import type { Register } from '../../../../definition/operands.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { SignatureParameter } from '../../../checker/check.ts';
import { argumentsInOrder, parameterOfArgument } from '../../../checker/surface/resolved-call.ts';
import type { RestSlot } from '../../../checker/types/type/function-types.ts';
import { argumentValue } from '../../../syntax/expressions/arguments.ts';
import type { Call, CallingNode } from '../../../syntax/expressions/calls.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import {
  calledName,
  callsThroughOptional,
  writtenArgumentsOf,
} from '../../../syntax/expressions/readings.ts';
import { type ClosedCall, calledParameters } from '../../calls/closed-calls.ts';
import { type CallTarget, emitTo } from '../../calls/emit-call.ts';
import { packElementsOf } from '../../calls/packs.ts';
import type { FunctionContext } from '../../context.ts';
import { enterReferenced } from '../parts/places.ts';
import { spreadArray } from './collections/collections.ts';
import { lowerFieldRead, readsField } from './structs/structs.ts';
import { fieldlessVariantCalled, lowerFieldlessVariant } from './structs/variants.ts';

export function lowerCall(context: FunctionContext, node: Call): Register {
  const fieldless = fieldlessVariantCalled(context, node);
  if (fieldless !== undefined) {
    return lowerFieldlessVariant(context, node, fieldless);
  }
  const { target, passed, arguments: given } = preparedCall(context, node, 'asWritten');
  const dst = emitTo(context, node.span, target, given);
  leaveAll(passed);
  return dst;
}

/**
 * A call ready to emit: what it calls, its arguments as passed, and how each is passed; for a
 * deferred call, where among those arguments the function it gives goes (§3.14), which is made
 * after them: past them for a resolved function, whose binding numbers it last, and at the
 * parameter it fills for a function value, which takes its arguments in its parameters' order.
 */
export interface PreparedCall {
  readonly target: CallTarget;
  readonly passed: readonly PassedArgument[];
  readonly arguments: readonly Argument[];
  readonly givenAt: number | undefined;
}

/**
 * What `node` calls and passes, evaluated in the order written: a function value's callee first,
 * then its arguments, each as written; a resolved function's receiver, then its arguments, by `&`
 * where their parameters take one, or all by value for a deferred call's parts (§3.14). A deferred call passes what its taker's parentheses write.
 */
export function preparedCall(
  context: FunctionContext,
  node: CallingNode,
  references: 'asWritten' | 'byValue',
): PreparedCall {
  if (context.body.valueCalls.has(node)) {
    const register = valueCallee(context, node);
    const passed = passedArguments(context, node, packsOnly);
    return {
      target: { kind: 'value', register },
      passed,
      ...valueArguments(context, node, passed),
    };
  }
  const call = context.callAt(node);
  const parameterAt = parametersByArgument(context, call);
  const byReference = (index: number) =>
    references === 'asWritten' && parameterAt(index)?.reference === true;
  const receiver = receiverOf(context, node, receiverAt(context, node), byReference(0));
  const passed = passedArguments(context, node, {
    receiver,
    byReference,
    spreadFills: (index) => restKindAt(parameterAt, index),
  });
  return {
    target: { kind: 'function', call },
    passed,
    arguments: passed.map(({ argument }) => argument),
    givenAt: node.kind === 'DeferredCall' ? passed.length : undefined,
  };
}

/** The receiver the method call `node` was written on (§3.7); undefined for any other call. */
function receiverAt(context: FunctionContext, node: CallingNode): Expression | undefined {
  return context.body.resolved.get(node)?.receiver;
}

/**
 * A method's receiver as its first argument (§3.7); through an optional chain, the value the
 * chain carries, which the checker passes only by value (§4).
 */
function receiverOf(
  context: FunctionContext,
  node: CallingNode,
  receiver: Expression | undefined,
  byReference: boolean,
): PassedArgument | undefined {
  if (receiver === undefined) {
    return undefined;
  }
  if (context.body.chainOf(node) === undefined) {
    return argumentOf(context, receiver, byReference);
  }
  return { argument: { kind: 'value', register: context.chains.target(context, node) } };
}

/**
 * The function value a value call calls; `f?.()` calls the one inside `f`, and `x.f(…)` the field
 * read from `x` (a namespace's constant `ns.f(…)` is read as a name).
 */
function valueCallee(context: FunctionContext, node: CallingNode): Register {
  if (callsThroughOptional(node)) {
    return context.chains.target(context, node);
  }
  const callee = calledName(node);
  return callee.kind === 'MemberAccess' && readsField(context, callee)
    ? lowerFieldRead(context, callee, node)
    : context.expression(callee);
}

/** An argument as the call passes it, and for a place copied in, how it is written back. */
export interface PassedArgument {
  readonly argument: Argument;
  readonly leave?: (() => void) | undefined;
}

/** The parameter of `called` each argument, numbered as its binding numbers them, fills. */
function parametersByArgument(
  context: FunctionContext,
  called: ClosedCall,
): (index: number) => SignatureParameter | undefined {
  const parameters = calledParameters(context.checker, called);
  const parameterOf = parameterOfArgument(called.binding);
  return (index) => {
    const parameter = parameterOf.get(index);
    return parameter === undefined ? undefined : parameters[parameter];
  };
}

/** What the spread argument `index` fills: the rest parameter `parameterAt` gives it. */
function restKindAt(
  parameterAt: (index: number) => SignatureParameter | undefined,
  index: number,
): RestSlot['kind'] {
  return parameterAt(index)?.rest?.kind ?? unreachable(`Spread ${index} fills no rest parameter.`);
}

/**
 * How a call passes its arguments: its receiver, already passed, which take `&`, and what each
 * spread fills, numbered as the binding numbers them.
 */
interface Passing {
  readonly receiver?: PassedArgument | undefined;
  readonly byReference: (index: number) => boolean;
  readonly spreadFills: (index: number) => RestSlot['kind'];
}

/** How a function value's call passes its arguments: by value, a spread only of a pack (§3.14). */
const packsOnly: Passing = { byReference: () => false, spreadFills: () => 'pack' };

/**
 * What a call passes, as written and numbered as its binding numbers it: a method's receiver,
 * already passed, then each argument in order, by reference where `byReference` says its parameter
 * takes one. A spread an array's rest takes gives its items as an array, made where it stands, so
 * a cursor runs in the order written (§3.3); a pack's spread is the pack's tuple (§3.5). What a
 * rest parameter takes of these is emit-call's to make. Every call is lowered through here.
 */
function passedArguments(
  context: FunctionContext,
  node: CallingNode,
  { receiver, byReference, spreadFills }: Passing,
): readonly PassedArgument[] {
  const offset = receiver === undefined ? 0 : 1;
  const passed: PassedArgument[] = receiver === undefined ? [] : [receiver];
  for (const [position, argument] of writtenArgumentsOf(node).entries()) {
    const index = position + offset;
    if (argument.kind === 'Spread') {
      const fills = spreadFills(index);
      const register =
        fills === 'pack' ? context.expression(argument.expression) : spreadArray(context, argument);
      passed.push({ argument: { kind: 'value', register } });
    } else {
      passed.push(argumentOf(context, argumentValue(argument), byReference(index)));
    }
  }
  return passed;
}

/**
 * The arguments a function value takes of what its call passes, in its parameters' order as the
 * checker bound them: each as passed, a pack's spread as the elements of its tuple, since the
 * value's type flattens the pack (§3.5); and where the function a deferred call gives goes among
 * them, the argument after those written (§3.14).
 */
function valueArguments(
  context: FunctionContext,
  node: CallingNode,
  passed: readonly PassedArgument[],
): Pick<PreparedCall, 'arguments' | 'givenAt'> {
  const { binding } = context.body.valueCalls.get(node) ?? {};
  const written = writtenArgumentsOf(node);
  const taken: Argument[] = [];
  let givenAt: number | undefined;
  for (const { index, isSpread } of argumentsInOrder(
    binding ?? unreachable('A function value called clean binds its arguments.'),
  )) {
    const argument = written[index];
    const given = passed[index]?.argument;
    if (node.kind === 'DeferredCall' && index === written.length) {
      givenAt = taken.length;
    } else if (argument === undefined || given === undefined) {
      unreachable(`Argument ${index} isn't passed.`);
    } else if (isSpread && argument.kind === 'Spread' && given.kind === 'value') {
      const elements = packElementsOf(context, given.register, {
        type: context.typeOf(argument.expression),
        span: argument.span,
      });
      taken.push(...elements.map((register) => ({ kind: 'value', register }) as const));
    } else {
      taken.push(given);
    }
  }
  return { arguments: taken, givenAt };
}

/**
 * How `argument` is passed: the place `&x` names, the receiver's place for a `&self`, or a value.
 */
function argumentOf(
  context: FunctionContext,
  argument: Expression,
  byReference: boolean,
): PassedArgument {
  const place = referencedPlace(argument, byReference);
  if (place === undefined) {
    return { argument: { kind: 'value', register: context.expression(argument) } };
  }
  const referenced = enterReferenced(context, place);
  return { argument: { kind: 'reference', place: referenced.place }, leave: referenced.leave };
}

/** The place an argument passes by `&`: written `&x`, or a receiver taken as `&self`. */
function referencedPlace(argument: Expression, byReference: boolean): Expression | undefined {
  if (argument.kind === 'Reference') {
    return argument.expression;
  }
  return byReference ? argument : undefined;
}

/** Writes back what the call's arguments copied in, the last first. */
export function leaveAll(argumentList: readonly PassedArgument[]): void {
  for (const { leave } of argumentList.toReversed()) {
    leave?.();
  }
}
