/**
 * Calls (§3.3, §3.7, §3.14), as lowering makes them (lowering/constructs/expressions/calls.ts):
 * arguments evaluated in the order written, a method's receiver first; one passed by `&` (written
 * `&x`, or a receiver whose `self` takes a reference) passes its place, and what an accessor read
 * for it is written back once the call returns. A call of a function value calls its callee's
 * value with its arguments in its parameters' order, as checking bound them; only one written `&x`
 * passes a place. A call naming a variant with no fields is that variant's value (§3.11). A
 * function a call gives after its arguments (`Call.given`) is its last argument.
 */

import { argumentValue } from '../../../../syntax/expressions/arguments.ts';
import type { Call } from '../../../../syntax/expressions/calls.ts';
import type { Expression } from '../../../../syntax/expressions/index.ts';
import { calledName, writtenArgumentsOf } from '../../../../syntax/expressions/readings.ts';
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
export function callFlow(builder: FlowBuilder, node: Call): ValueId {
  const into = builder.temporaryOf(node);
  if (builder.body.valueCalls.has(node)) {
    const callee = calleeValue(builder, node);
    const { arguments: passed, leave } = prepared(builder, node, undefined);
    const ordered = inParameterOrder(builder, node, passed);
    builder.emit({ op: 'callValue', site: node, into, callee, arguments: ordered });
    leave();
    return into;
  }
  const call = builder.body.resolved.get(node);
  if (call === undefined) {
    builder.emit(unresolved(builder, node, into));
    return into;
  }
  const { arguments: passed, leave } = prepared(builder, node, call);
  resolvedCall(builder, call, { site: node, passed, into });
  leave();
  encodedOutcome(builder, node);
  return into;
}

/**
 * A call neither resolved nor of a value: a variant's with no fields, its value (§3.11); else a
 * mistake checking reported, whose parts run all the same.
 */
function unresolved(builder: FlowBuilder, node: Call, into: ValueId) {
  const { checker, module } = builder.inputs;
  const names = {
    entityOf: (name: Parameters<typeof checker.bindings.entityOf>[1]) =>
      checker.bindings.entityOf(module, name),
    chosenVariantOf: builder.body.chosenVariantOf,
  };
  const variant = calledVariant(names, node);
  if (variant !== undefined && variant.variant.fields.length === 0) {
    return { op: 'compute', site: node, into, operands: [] } as const;
  }
  const callee = builder.expression(calledName(node));
  const { arguments: passed } = prepared(builder, node, undefined);
  const operands = passed.map((argument) =>
    argument.kind === 'value' ? argument.value : builder.valueAt(argument.place),
  );
  return { op: 'unknown', site: node, into, operands: [callee, ...operands] } as const;
}

/**
 * The codec writing the outcome of the instance an extern call starts (§9), which the started
 * instance runs on what it gives, where checking recorded one.
 */
function encodedOutcome(builder: FlowBuilder, node: Call): void {
  if (builder.body.implicitCallOf(node, 'encodeOutcome') !== undefined) {
    implicitCall(builder, 'encodeOutcome', { site: node, passed: [] });
  }
}

/**
 * The function value a value call calls: the one inside an optional for `f?.()`, the field read
 * from `x` for `x.f(…)`, else its callee's value.
 */
function calleeValue(builder: FlowBuilder, node: Call): ValueId {
  const callee = calledName(node);
  if (node.isOptional) {
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
 * The arguments a function value takes, `passed` as written, in its parameters' order as checking
 * bound them (`ValueCallMade`).
 */
function inParameterOrder(
  builder: FlowBuilder,
  node: Call,
  passed: readonly Argument[],
): readonly Argument[] {
  const binding = builder.body.valueCalls.get(node)?.binding;
  return binding === undefined
    ? passed
    : argumentsInOrder(binding).flatMap(({ index }) => passed[index] ?? []);
}

/** `node`'s receiver and written arguments, as written: each by `&` where its parameter takes one. */
function prepared(builder: FlowBuilder, node: Call, call: ResolvedCall | undefined): Prepared {
  const parameterAt = parametersOf(builder, call);
  const passed: Argument[] = [];
  const leaves: (() => void)[] = [];
  const pass = (argument: Expression, index: number) => {
    const place = argument.kind === 'Reference' ? argument.expression : undefined;
    const byReference = parameterAt(index)?.reference === true;
    if (place !== undefined || byReference) {
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
