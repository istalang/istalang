/**
 * Calls (§3.3, §3.7, §3.14), as lowering makes them (lowering/constructs/expressions/calls.ts):
 * arguments evaluated in the order written, a method's receiver first; one passed by `&` (written
 * `&x`, or a receiver whose `self` takes a reference) passes its place, and what an accessor read
 * for it is written back once the call returns. A call of a function value calls its callee's
 * value, every argument by value.
 *
 * A deferred call `g f(args)` (§3.14) computes now its taker's parts, then what its call computes
 * now, by value, and gives its taker, beside what its parentheses write, a closure of a function of
 * its own capturing those values, which makes the call later; a deferred call within it builds
 * its own function from its captures first.
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
import { parameterOfArgument, type ResolvedCall } from '../../../surface/resolved-call.ts';
import type { Argument, ValueId } from '../flow-ir.ts';
import { throughOptional } from './chains.ts';
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
    const { arguments: passed } = prepared(builder, node, undefined, 'asWritten');
    if (node.kind === 'DeferredCall') {
      passed.push({ kind: 'value', value: deferredFunction(builder, node) });
    }
    builder.emit({ op: 'callValue', site: node, into, callee, arguments: passed });
    return into;
  }
  const call = builder.body.resolved.get(node);
  if (call === undefined) {
    // Neither resolved nor of a value, which checking reported: its parts run all the same.
    const callee = builder.expression(calledName(node));
    const { arguments: passed } = prepared(builder, node, undefined, 'asWritten');
    const operands = passed.map((argument) =>
      argument.kind === 'value' ? argument.value : argument.place.root,
    );
    const later = node.kind === 'DeferredCall' ? [builder.expression(node.call)] : [];
    builder.emit({ op: 'unknown', site: node, into, operands: [callee, ...operands, ...later] });
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
    return throughOptional(builder, node, builder.expression(callee));
  }
  const read = callee.kind === 'MemberAccess' ? builder.body.fieldReadOf(callee) : undefined;
  if (callee.kind !== 'MemberAccess' || read === undefined) {
    return builder.expression(callee);
  }
  const target = throughOptional(builder, callee, builder.expression(callee.target));
  const value = builder.temporaryOf(callee);
  builder.emit({ op: 'read', site: callee, into: value, from: target, part: partOfField(read) });
  return value;
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
      const value = throughOptional(builder, node, builder.expression(receiver));
      passed.push({ kind: 'value', value });
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
  const values = computedNow(builder, call);
  const later = builder.nested(node.call);
  const captured = values.map((value) =>
    later.capturedValue(builder.valueOf(value).type, node.call),
  );
  later.end({ kind: 'return', value: madeLater(later, call, captured), site: node.call });
  const made = builder.temporary(node.call, builder.body.deferredFunctionOf(node.call));
  builder.emit({
    op: 'make',
    site: node.call,
    into: made,
    made: { kind: 'closure', function: later.finished(undefined) },
    parts: values,
  });
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
  const [callee, ...rest] = isValue ? captured : [undefined, ...captured];
  const count = writtenArgumentsOf(call).length + (later.body.resolved.get(call)?.receiver ? 1 : 0);
  const passed: Argument[] = rest
    .slice(0, count)
    .map((value) => ({ kind: 'value', value: value as ValueId }));
  const inner = call.kind === 'DeferredCall' ? deferredOf(call) : undefined;
  if (inner !== undefined) {
    const innerLater = later.nested(call);
    const innerCaptured = rest
      .slice(count)
      .map((value) => innerLater.capturedValue(later.valueOf(value as ValueId).type, call));
    innerLater.end({
      kind: 'return',
      value: madeLater(innerLater, inner, innerCaptured),
      site: call,
    });
    const made = later.temporary(call, undefined);
    later.emit({
      op: 'make',
      site: call,
      into: made,
      made: { kind: 'closure', function: innerLater.finished(undefined) },
      parts: rest.slice(count) as ValueId[],
    });
    passed.push({ kind: 'value', value: made });
  }
  if (isValue && callee !== undefined) {
    later.emit({ op: 'callValue', site: call, into, callee, arguments: passed });
  } else {
    resolvedCall(later, later.body.resolved.get(call), { site: call, passed, into });
  }
  return into;
}
