/**
 * Calls (§3.3, §3.7, §3.14), as lowering makes them (lowering/constructs/expressions/calls.ts):
 * arguments evaluated in the order written, a method's receiver first; one passed by `&` (written
 * `&x`, or a receiver whose `self` takes a reference) passes its place, and what an accessor read
 * for it is written back once the call returns. A call of a function value calls its callee's
 * value with its arguments in its parameters' order, as checking bound them; only one written `&x`
 * passes a place. A call naming a variant with no fields is that variant's value (§3.11).
 *
 * A deferred call `g f(args)` (§3.14) computes now its taker's parts, then what its call computes
 * now, by value, and gives its taker, where the binding numbers it, a closure of a function of its
 * own capturing those values, which makes the call later; a deferred call within it builds its own
 * function from its captures first.
 */

import { argumentValue } from '../../../../syntax/expressions/arguments.ts';
import type { CallingNode, DeferredCall } from '../../../../syntax/expressions/calls.ts';
import type { Expression } from '../../../../syntax/expressions/index.ts';
import {
  calledName,
  callsThroughOptional,
  deferredOf,
  writtenArgumentsOf,
} from '../../../../syntax/expressions/readings.ts';
import type { SignatureParameter } from '../../../check.ts';
import { calledVariant } from '../../../surface/named-variants.ts';
import {
  argumentsInOrder,
  parameterOfArgument,
  type ResolvedCall,
} from '../../../surface/resolved-call.ts';
import type { Argument, ValueId } from '../flow-ir.ts';
import { stepTarget } from './chains.ts';
import type { FlowBuilder } from './flow-builder.ts';
import { implicitCall, resolvedCall } from './implicit-calls.ts';
import { spreadValue } from './literals.ts';
import { enterPlace, leaveAll, partOfField } from './places.ts';

/** A call evaluated now: its arguments as passed, and how to write back what they copied in. */
interface Prepared {
  readonly arguments: Argument[];
  readonly leave: () => void;
}

/** `node`'s call, its value in a temporary of its own. */
export function callFlow(builder: FlowBuilder, node: CallingNode): ValueId {
  const into = builder.temporaryOf(node);
  if (builder.body.valueCalls.has(node)) {
    const callee = calleeValue(builder, node);
    const { arguments: passed, leave } = prepared(builder, node, undefined, 'asWritten');
    const given = node.kind === 'DeferredCall' ? deferredFunction(builder, node) : undefined;
    const ordered = inParameterOrder(builder, node, passed, given);
    builder.emit({ op: 'callValue', site: node, into, callee, arguments: ordered });
    leave();
    return into;
  }
  const call = builder.body.resolved.get(node);
  if (call === undefined) {
    builder.emit(unresolved(builder, node, into));
    return into;
  }
  const { arguments: passed, leave } = prepared(builder, node, call, 'asWritten');
  if (node.kind === 'DeferredCall') {
    passed.push({ kind: 'value', value: deferredFunction(builder, node) });
  }
  resolvedCall(builder, call, { site: node, passed, into });
  leave();
  encodedOutcome(builder, node);
  return into;
}

/**
 * A call neither resolved nor of a value: a variant's with no fields, its value (§3.11); else a
 * mistake checking reported, whose parts run all the same.
 */
function unresolved(builder: FlowBuilder, node: CallingNode, into: ValueId) {
  const { checker, module } = builder.inputs;
  const names = {
    entityOf: (name: Parameters<typeof checker.bindings.entityOf>[1]) =>
      checker.bindings.entityOf(module, name),
    chosenVariantOf: builder.body.chosenVariantOf,
  };
  const variant = node.kind === 'Call' ? calledVariant(names, node) : undefined;
  if (variant !== undefined && variant.variant.fields.length === 0) {
    return { op: 'compute', site: node, into, operands: [] } as const;
  }
  const callee = builder.expression(calledName(node));
  const { arguments: passed } = prepared(builder, node, undefined, 'asWritten');
  const operands = passed.map((argument) =>
    argument.kind === 'value' ? argument.value : builder.valueAt(argument.place),
  );
  const later = node.kind === 'DeferredCall' ? [builder.expression(node.call)] : [];
  return { op: 'unknown', site: node, into, operands: [callee, ...operands, ...later] } as const;
}

/**
 * The codec writing the outcome of the instance an extern call starts (§9), which the started
 * instance runs on what it gives, where checking recorded one.
 */
function encodedOutcome(builder: FlowBuilder, node: CallingNode): void {
  if (builder.body.implicitCallOf(node, 'encodeOutcome') !== undefined) {
    implicitCall(builder, 'encodeOutcome', { site: node, passed: [] });
  }
}

/**
 * The function value a value call calls: the one inside an optional for `f?.()`, the field read
 * from `x` for `x.f(…)`, else its callee's value.
 */
function calleeValue(builder: FlowBuilder, node: CallingNode): ValueId {
  const callee = calledName(node);
  if (callsThroughOptional(node)) {
    return stepTarget(builder, node, callee);
  }
  const read = callee.kind === 'MemberAccess' ? builder.body.fieldReadOf(callee) : undefined;
  if (callee.kind !== 'MemberAccess' || read === undefined) {
    return builder.expression(callee);
  }
  const target = stepTarget(builder, node, callee.target);
  const value = builder.temporaryOf(callee);
  builder.emit({ op: 'read', site: callee, into: value, from: target, part: partOfField(read) });
  return value;
}

/**
 * The arguments a function value takes, `passed` as written and `given`, a deferred call's
 * function, in its parameters' order as checking bound them (`ValueCallMade`).
 */
function inParameterOrder(
  builder: FlowBuilder,
  node: CallingNode,
  passed: readonly Argument[],
  given: ValueId | undefined,
): readonly Argument[] {
  const all: readonly Argument[] =
    given === undefined ? passed : [...passed, { kind: 'value', value: given }];
  const binding = builder.body.valueCalls.get(node)?.binding;
  return binding === undefined
    ? all
    : argumentsInOrder(binding).flatMap(({ index }) => all[index] ?? []);
}

/**
 * `node`'s receiver and written arguments: as written, each by `&` where its parameter takes one,
 * or all by value, as a deferred call computes them now (§3.14).
 */
function prepared(
  builder: FlowBuilder,
  node: CallingNode,
  call: ResolvedCall | undefined,
  references: 'asWritten' | 'byValue',
): Prepared {
  const parameterAt = parametersOf(builder, call);
  const passed: Argument[] = [];
  const leaves: (() => void)[] = [];
  const pass = (argument: Expression, index: number) => {
    const place = argument.kind === 'Reference' ? argument.expression : undefined;
    const byReference = parameterAt(index)?.reference === true;
    if (references === 'asWritten' && (place !== undefined || byReference)) {
      const entered = enterPlace(builder, place ?? argument);
      passed.push({ kind: 'place', place: entered.place });
      leaves.push(entered.leave);
    } else {
      passed.push({ kind: 'value', value: builder.expression(argument) });
    }
  };
  const receiver = call?.receiver;
  if (receiver !== undefined) {
    if (builder.body.chainOf(node) === undefined) {
      pass(receiver, 0);
    } else {
      passed.push({ kind: 'value', value: stepTarget(builder, node, receiver) });
    }
  }
  const offset = receiver === undefined ? 0 : 1;
  for (const [position, argument] of writtenArgumentsOf(node).entries()) {
    if (argument.kind === 'Spread') {
      const isPack = call === undefined || parameterAt(position + offset)?.rest?.kind === 'pack';
      passed.push({ kind: 'value', value: spreadValue(builder, argument, isPack) });
    } else {
      pass(argumentValue(argument), position + offset);
    }
  }
  return { arguments: passed, leave: () => leaveAll(leaves) };
}

/** The parameter of `call`'s function each argument, by number, fills; none for a value call. */
function parametersOf(
  builder: FlowBuilder,
  call: ResolvedCall | undefined,
): (index: number) => SignatureParameter | undefined {
  if (call === undefined) {
    return () => undefined;
  }
  const parameters = builder.inputs.checker.parametersOf(call.function);
  const parameterOf = parameterOfArgument(call.binding);
  return (index) => {
    const parameter = parameterOf.get(index);
    return parameter === undefined ? undefined : parameters[parameter];
  };
}

/**
 * The function `node` gives its taker: a closure capturing what its call computes now, of a
 * function making the call from them; its call's value where the call was never made, which
 * checking reported.
 */
function deferredFunction(builder: FlowBuilder, node: DeferredCall): ValueId {
  const call = deferredOf(node);
  if (call === undefined || !isMade(builder, call)) {
    return builder.expression(node.call);
  }
  return closureMaking(builder, node, computedNow(builder, call));
}

/**
 * The closure `node` gives its taker, made in `builder` of `values`: a function capturing them,
 * which makes `node`'s call from them.
 */
function closureMaking(
  builder: FlowBuilder,
  node: DeferredCall,
  values: readonly ValueId[],
): ValueId {
  const call = deferredOf(node) as CallingNode;
  const later = builder.nested(node.call);
  const captured = values.map((value) =>
    later.capturedValue(builder.valueOf(value).type, node.call),
  );
  later.end({ kind: 'return', value: madeLater(later, call, captured), site: node.call });
  const made = builder.temporary(node.call, builder.body.deferredFunctionOf(node.call));
  const closure = { kind: 'closure', function: later.finished(undefined) } as const;
  builder.emit({ op: 'make', site: node.call, into: made, made: closure, parts: values });
  return made;
}

/** Whether `call`, and each call it defers in turn, was recorded made (§2). */
function isMade(builder: FlowBuilder, call: CallingNode): boolean {
  const { resolved, valueCalls } = builder.body;
  if (!(resolved.has(call) || valueCalls.has(call))) {
    return false;
  }
  const inner = call.kind === 'DeferredCall' ? deferredOf(call) : undefined;
  return call.kind === 'Call' || (inner !== undefined && isMade(builder, inner));
}

/**
 * What `call` computes now, in the order it runs: a value call's callee, or a method's receiver,
 * then its arguments, by value; then, for a deferred call, what its own call computes now.
 */
function computedNow(builder: FlowBuilder, call: CallingNode): readonly ValueId[] {
  const isValue = builder.body.valueCalls.has(call);
  const callee = isValue ? [calleeValue(builder, call)] : [];
  const resolved = isValue ? undefined : builder.body.resolved.get(call);
  const { arguments: passed } = prepared(builder, call, resolved, 'byValue');
  const now = passed.map((argument) =>
    argument.kind === 'value' ? argument.value : argument.place.root,
  );
  const inner = call.kind === 'DeferredCall' ? deferredOf(call) : undefined;
  return [...callee, ...now, ...(inner === undefined ? [] : computedNow(builder, inner))];
}

/** `call` made from `captured`, the values it computed when its function was made. */
function madeLater(later: FlowBuilder, call: CallingNode, captured: readonly ValueId[]): ValueId {
  const into = later.temporaryOf(call);
  const isValue = later.body.valueCalls.has(call);
  const resolved = isValue ? undefined : later.body.resolved.get(call);
  const [callee, ...rest] = isValue ? captured : [undefined, ...captured];
  const count = writtenArgumentsOf(call).length + (resolved?.receiver === undefined ? 0 : 1);
  const passed = rest
    .slice(0, count)
    .map((value): Argument => ({ kind: 'value', value: value as ValueId }));
  const given =
    call.kind === 'DeferredCall'
      ? closureMaking(later, call, rest.slice(count) as ValueId[])
      : undefined;
  if (callee === undefined) {
    const all = given === undefined ? passed : [...passed, given];
    resolvedCall(later, resolved, { site: call, passed: all, into });
  } else {
    const ordered = inParameterOrder(later, call, passed, given);
    later.emit({ op: 'callValue', site: call, into, callee, arguments: ordered });
  }
  return into;
}
