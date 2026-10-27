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
 * Arguments are evaluated in the order written, named ones included (§3.3). Those a rest parameter
 * collects stand together after the fixed ones, and are built into its array, as an array literal
 * of them is, where the first of them stands; the call's binding is renumbered to pass that array.
 *
 * A call the checker resolved no function for is a call of a function value (§3.14): the callee's
 * value is the closure called, and each argument is passed as written, which the checker matched
 * to the closure's parameters.
 */

import type { Callee } from '../../../definition/instructions/calls.ts';
import type { Argument } from '../../../definition/instructions/places.ts';
import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { type Binding, parameterOfArgument } from '../../checker/resolved-call.ts';
import {
  argumentValue,
  type Call,
  type Expression,
  type Spawn,
  unparenthesized,
} from '../../syntax/expressions/index.ts';
import type { FunctionContext } from '../context.ts';
import { emitCall, emitFunctionCall } from '../emit-call.ts';
import type { ClosedCall } from '../instances.ts';
import { enterReferenced } from '../places.ts';
import { arrayOf } from './collections.ts';
import { lowerFieldRead } from './structs.ts';

export function lowerCall(context: FunctionContext, node: Call): Register {
  const resolved = context.body.calls.get(node);
  if (resolved === undefined) {
    return lowerValueCall(context, node);
  }
  const called = context.callAt(node);
  const byReference = referenceParameters(context, called);
  const receiver = receiverOf(context, node, resolved.receiver, byReference(0));
  const passed = passedArguments(context, node, { receiver, byReference, rest: restItems(called) });
  const dst = emitFunctionCall(context, {
    span: node.span,
    call: passedCall(called, passed.numbers),
    arguments: passed.list.map(({ argument }) => argument),
  });
  leaveAll(passed.list);
  return dst;
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
 * A call of the function value `node.callee` evaluates to. A field's, `x.f(…)`, is read from the
 * value the call works on, since the call, not the access, is the link of an optional chain.
 */
function lowerValueCall(context: FunctionContext, node: Call): Register {
  const callee = valueCallee(context, node);
  const { list } = passedArguments(context, node, { byReference: () => false, rest: [] });
  const dst = emitCall(context, {
    span: node.span,
    callee: { kind: 'value', register: callee },
    arguments: list.map(({ argument }) => argument),
  });
  leaveAll(list);
  return dst;
}

/** The function value a call of no resolved function calls; `f?.()` calls the one inside `f`. */
function valueCallee(context: FunctionContext, node: Call): Register {
  if (node.isOptional) {
    return context.chains.target(context, node);
  }
  return node.callee.kind === 'MemberAccess'
    ? lowerFieldRead(context, node.callee, node)
    : context.expression(node.callee);
}

/**
 * `spawn f(args)` (§9): what the call would run, the function the checker resolved, taking its
 * arguments as passed so the new instance computes any defaults, or the value of a sendable
 * function type; and its arguments, a method's receiver first, all by value; its value is the new
 * instance's `Instance<T>`.
 */
export function lowerSpawn(context: FunctionContext, node: Spawn): Register {
  const spawned = unparenthesized(node.call);
  if (spawned.kind !== 'Call') {
    unreachable('A spawn of no call checked clean.');
  }
  const resolved = context.body.calls.get(spawned);
  const called = resolved === undefined ? undefined : context.callAt(spawned);
  const value: Callee | undefined =
    called === undefined ? { kind: 'value', register: valueCallee(context, spawned) } : undefined;
  const receiver =
    resolved?.receiver === undefined ? undefined : argumentOf(context, resolved.receiver, false);
  const rest = called === undefined ? [] : restItems(called);
  const copied = passedArguments(context, spawned, { receiver, byReference: () => false, rest });
  const callee: Callee = value ?? {
    kind: 'function',
    function: context.tables.callIndex(
      passedCall(called ?? unreachable('A spawn calls nothing.'), copied.numbers),
    ),
  };
  const instance = context.body.typeOf(node);
  if (instance.kind !== 'nominal') {
    unreachable('A spawn checked clean is an Instance<T>.');
  }
  const dst = context.code.allocate();
  context.code.emit({
    kind: 'spawn',
    span: node.span,
    dst,
    type: context.tables.types.index(instance),
    callee,
    arguments: copied.list.map(({ argument }) => {
      if (argument.kind !== 'value') {
        unreachable('A spawned call passes everything by value; the checker refuses references.');
      }
      return argument.register;
    }),
  });
  return dst;
}

/** An argument as the call passes it, and for a place copied in, how it is written back. */
interface PassedArgument {
  readonly argument: Argument;
  readonly leave?: (() => void) | undefined;
}

/** Whether the parameter `called` passes its `index`-th argument to takes a reference (§3.7). */
function referenceParameters(
  context: FunctionContext,
  called: ClosedCall,
): (index: number) => boolean {
  const declaration =
    called.kind === 'dispatch' ? called.dispatch.required : called.instance.declaration;
  const parameters = context.checker.parametersOf(declaration);
  const parameterOf = parameterOfArgument(called.binding);
  return (index) => {
    const parameter = parameterOf.get(index);
    return parameter !== undefined && parameters[parameter]?.reference === true;
  };
}

/**
 * How a call passes its arguments: its receiver, already passed, which take `&`, and which a rest
 * parameter collects, numbered as the binding numbers them.
 */
interface Passing {
  readonly receiver?: PassedArgument | undefined;
  readonly byReference: (index: number) => boolean;
  readonly rest: readonly number[];
}

/** The arguments a rest parameter of `called` collects, numbered as passed. */
function restItems(called: ClosedCall): readonly number[] {
  return called.binding.flatMap((source) => (source.kind === 'rest' ? source.items : []));
}

/** `called`, its binding numbering what is passed as `numbers` renumbered it (`passedArguments`). */
function passedCall(called: ClosedCall, numbers: ReadonlyMap<number, number>): ClosedCall {
  return { ...called, binding: called.binding.map((source) => renumbered(source, numbers)) };
}

/**
 * What a call passes, as written: a method's receiver, already passed, then each argument, by
 * reference where `byReference` says its parameter takes one, those a rest parameter collects
 * built into its array; and by argument number, where each now stands. Every call is lowered
 * through here, a spawned one included.
 */
function passedArguments(
  context: FunctionContext,
  node: Call,
  { receiver, byReference, rest }: Passing,
): { readonly list: readonly PassedArgument[]; readonly numbers: ReadonlyMap<number, number> } {
  const offset = receiver === undefined ? 0 : 1;
  const list: PassedArgument[] = receiver === undefined ? [] : [receiver];
  const numbers = new Map<number, number>(receiver === undefined ? [] : [[0, 0]]);
  const [first] = rest;
  for (const [position, argument] of node.arguments.entries()) {
    const index = position + offset;
    const isRestItem = rest.includes(index);
    if (!isRestItem) {
      list.push(argumentOf(context, argumentValue(argument), byReference(index)));
    } else if (index === first) {
      const elements = rest.map((item) => restElement(node, item - offset));
      const register = arrayOf(context, elements, node.span);
      list.push({ argument: { kind: 'value', register } });
    }
    const array = first === undefined ? undefined : numbers.get(first);
    numbers.set(index, isRestItem && array !== undefined ? array : list.length - 1);
  }
  return { list, numbers };
}

/** A written argument a rest parameter collects: an item, or a spread. */
function restElement(
  node: Call,
  position: number,
): Expression | Extract<Call['arguments'][number], { kind: 'Spread' }> {
  const argument = node.arguments[position];
  if (argument === undefined || argument.kind === 'NamedArgument') {
    unreachable(`A rest parameter collects no argument ${position}.`);
  }
  return argument;
}

/** `source`, its arguments numbered as passed, a rest parameter's items as the one array. */
function renumbered(
  source: Binding[number],
  numbers: ReadonlyMap<number, number>,
): Binding[number] {
  const numberOf = (index: number) =>
    numbers.get(index) ?? unreachable(`Argument ${index} isn't passed.`);
  switch (source.kind) {
    case 'argument':
      return { kind: 'argument', index: numberOf(source.index) };
    case 'rest': {
      const [first] = source.items;
      return first === undefined ? source : { kind: 'argument', index: numberOf(first) };
    }
    case 'default':
      return source;
    default: {
      const unhandled: never = source;
      return unhandled;
    }
  }
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
