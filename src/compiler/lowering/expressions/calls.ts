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
 */

import type { Callee } from '../../../definition/instructions/calls.ts';
import type { Argument } from '../../../definition/instructions/places.ts';
import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { SignatureParameter } from '../../checker/check.ts';
import { parameterOfArgument } from '../../checker/resolved-call.ts';
import type { RestSlot } from '../../checker/types/function-types.ts';
import { argumentValue } from '../../syntax/expressions/arguments.ts';
import {
  type Call,
  type Expression,
  type Spawn,
  unparenthesized,
} from '../../syntax/expressions/index.ts';
import { type ClosedCall, calledParameters } from '../closed-calls.ts';
import type { FunctionContext } from '../context.ts';
import { emitCall, emitFunctionCall } from '../emit-call.ts';
import { packElementsOf } from '../packs.ts';
import { enterReferenced } from '../places.ts';
import { spreadArray } from './collections.ts';
import { lowerFieldRead, readsField } from './structs.ts';

export function lowerCall(context: FunctionContext, node: Call): Register {
  const { target, passed, arguments: given } = preparedCall(context, node, 'asWritten');
  const { span } = node;
  const dst =
    target.kind === 'function'
      ? emitFunctionCall(context, { span, call: target.call, arguments: given })
      : emitCall(context, { span, callee: target, arguments: given });
  leaveAll(passed);
  return dst;
}

/**
 * `spawn f(args)` (§9): what the call would run, the function the checker resolved, taking its
 * arguments as passed so the new instance computes any defaults, or the value of a sendable
 * function type; and its arguments, a method's receiver first, all by value; its value is the new
 * instance's `Instance<T>`. The codec the checker found writing `T`, if any, closed within this
 * instance, is the new instance's encoder, so its outcome reaches its host as JSON.
 */
export function lowerSpawn(context: FunctionContext, node: Spawn): Register {
  const spawned = unparenthesized(node.call);
  if (spawned.kind !== 'Call') {
    unreachable('A spawn of no call checked clean.');
  }
  const { target, arguments: given } = preparedCall(context, spawned, 'byValue');
  const callee: Callee =
    target.kind === 'function'
      ? { kind: 'function', function: context.tables.callIndex(target.call) }
      : target;
  const instance = context.typeOf(node);
  if (instance.kind !== 'nominal') {
    unreachable('A spawn checked clean is an Instance<T>.');
  }
  const encoderCall = context.body.implicitCallOf(node, 'encodeOutcome');
  const encoder =
    encoderCall === undefined ? undefined : context.tables.callIndex(context.closed(encoderCall));
  const dst = context.code.allocate();
  context.code.emit({
    kind: 'spawn',
    span: node.span,
    dst,
    type: context.tables.types.index(instance),
    callee,
    arguments: given.map((argument) => {
      if (argument.kind !== 'value') {
        unreachable('A spawned call passes everything by value; the checker refuses references.');
      }
      return argument.register;
    }),
    ...(encoder !== undefined && { encoder }),
  });
  return dst;
}

/** What a call calls: the function the checker resolved, or the value of its callee (§3.14). */
type CallTarget =
  | { readonly kind: 'function'; readonly call: ClosedCall }
  | { readonly kind: 'value'; readonly register: Register };

/** A call ready to emit: what it calls, its arguments as passed, and how each is passed. */
interface PreparedCall {
  readonly target: CallTarget;
  readonly passed: readonly PassedArgument[];
  readonly arguments: readonly Argument[];
}

/**
 * What `node` calls and passes, evaluated in the order written: a function value's callee first,
 * then its arguments, each as written; a resolved function's receiver, then its arguments, by `&`
 * where their parameters take one, or all by value for a spawn (§9).
 */
function preparedCall(
  context: FunctionContext,
  node: Call,
  references: 'asWritten' | 'byValue',
): PreparedCall {
  if (context.body.valueCalls.has(node)) {
    const register = valueCallee(context, node);
    const passed = passedArguments(context, node, packsOnly);
    return {
      target: { kind: 'value', register },
      passed,
      arguments: valueArguments(context, node, passed),
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
  };
}

/** The receiver the method call `node` was written on (§3.7); undefined for any other call. */
function receiverAt(context: FunctionContext, node: Call): Expression | undefined {
  return context.body.resolved.get(node)?.receiver;
}

/**
 * A method's receiver as its first argument (§3.7); through an optional chain, the value the
 * chain carries, which the checker passes only by value (§4).
 */
function receiverOf(
  context: FunctionContext,
  node: Call,
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
function valueCallee(context: FunctionContext, node: Call): Register {
  if (node.isOptional) {
    return context.chains.target(context, node);
  }
  const { callee } = node;
  return callee.kind === 'MemberAccess' && readsField(context, callee)
    ? lowerFieldRead(context, callee, node)
    : context.expression(callee);
}

/** An argument as the call passes it, and for a place copied in, how it is written back. */
interface PassedArgument {
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
  node: Call,
  { receiver, byReference, spreadFills }: Passing,
): readonly PassedArgument[] {
  const offset = receiver === undefined ? 0 : 1;
  const passed: PassedArgument[] = receiver === undefined ? [] : [receiver];
  for (const [position, argument] of node.arguments.entries()) {
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
 * The arguments a function value takes of what its call passes: each as passed, a pack's spread
 * as the elements of its tuple, since the value's type flattens the pack (§3.5).
 */
function valueArguments(
  context: FunctionContext,
  node: Call,
  passed: readonly PassedArgument[],
): readonly Argument[] {
  return node.arguments.flatMap((argument, index) => {
    const { argument: given } = passed[index] ?? unreachable(`Argument ${index} isn't passed.`);
    if (argument.kind !== 'Spread' || given.kind !== 'value') {
      return [given];
    }
    const elements = packElementsOf(context, given.register, {
      type: context.typeOf(argument.expression),
      span: argument.span,
    });
    return elements.map((register) => ({ kind: 'value', register }) as const);
  });
}

/** How `argument` is passed: the place `&x` names, the receiver's place for a `&self`, or a value. */
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
function leaveAll(argumentList: readonly PassedArgument[]): void {
  for (const { leave } of argumentList.toReversed()) {
    leave?.();
  }
}
