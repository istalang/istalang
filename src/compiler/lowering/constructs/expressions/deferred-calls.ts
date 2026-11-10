/**
 * Deferred calls (§3.14; the checker's constructs/expressions/deferred-calls.ts): `g f(args)` calls
 * its taker as a call calls its callee (calls.ts), passing the function making `f(args)` later
 * after what the taker's parentheses write, where the checker's binding numbers it.
 *
 * - What the call computes now is computed here, after the taker's parts, by value: its callee's
 *   value or its receiver, then its arguments; a deferred call within it computes its taker's parts
 *   and its own call's, so every value is computed once, now. The function is a closure of an entry
 *   of its own, capturing copies of them in that order: a variable a closure or a `&` shares is a
 *   cell, which a closure would share too, and a copy captures the value it holds now.
 * - The entry, one per call in a body's instance, makes the call from its captures, closed as that
 *   instance closed it, so a default the call leaves out is computed when it runs; a deferred call
 *   within builds the function it gives from its own captures first. What the call gives is
 *   returned as the function is given (functions/fits/ `returnedAs`): an async callee's future as
 *   it is, a value where a future is taken from an async entry.
 * - A call that stops before it is made lowers as the checker recorded the stop, which leaves
 *   before any function is built.
 */

import type { Register } from '../../../../definition/operands.ts';
import type { CodeFunction } from '../../../../definition/tables/functions.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import { functionType, takesNothing } from '../../../checker/types/type/function-types.ts';
import type { CallingNode, DeferredCall } from '../../../syntax/expressions/calls.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import { deferredOf } from '../../../syntax/expressions/readings.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import { type CallTarget, emitTo } from '../../calls/emit-call.ts';
import type { CodeContext, FunctionContext } from '../../context.ts';
import { returnedAs } from '../../functions/fits/index.ts';
import { builtKindOf, codeModeOf } from '../../functions/modes.ts';
import { SynthesizedCode } from '../../synthesized/index.ts';
import {
  type DeferredFunction,
  type DeferredPlan,
  ownerDeclaration,
} from '../../tables/instances.ts';
import { copied } from '../statements/variables.ts';
import { leaveAll, preparedCall } from './calls.ts';

export function lowerDeferredCall(context: FunctionContext, node: DeferredCall): Register {
  const { target, passed, arguments: given, givenAt } = preparedCall(context, node, 'asWritten');
  const function_ = { kind: 'value', register: deferredFunction(context, node) } as const;
  const dst = emitTo(context, node.span, target, given.toSpliced(givenAtOf(givenAt), 0, function_));
  leaveAll(passed);
  return dst;
}

/** Where among a deferred call's arguments its function goes, which its preparing says. */
function givenAtOf(givenAt: number | undefined): number {
  return givenAt ?? unreachable('A deferred call is prepared with a place for its function.');
}

/** The function `node` gives its taker: a closure of its entry over what its call computes now. */
function deferredFunction(context: FunctionContext, node: DeferredCall): Register {
  if (!isMade(context, node)) {
    return context.expression(node.call);
  }
  const { plan, values } = givenFunction(context, node);
  const { span } = node.call;
  const copies = values.map((value) => copied(context, value, span));
  return closure(context, context.deferredIndex(plan), copies, span);
}

/**
 * Whether every call `node` defers, in turn, was recorded made: one that stops before it is made,
 * its callee or receiver having no value, is recorded as neither resolved nor of a value (§2).
 */
function isMade(context: FunctionContext, node: DeferredCall): boolean {
  const call = deferredOf(node);
  const { resolved, valueCalls } = context.body;
  const made = call !== undefined && (resolved.has(call) || valueCalls.has(call));
  return made && (call.kind === 'Call' || isMade(context, call));
}

/**
 * What `call`, written as `site`, computes now, evaluated in the order it runs, and the plan making
 * it later from those values.
 */
function computedNow(
  context: FunctionContext,
  call: CallingNode,
  site: Expression,
): { readonly plan: DeferredPlan; readonly values: readonly Register[] } {
  const { target, arguments: given, givenAt } = preparedCall(context, call, 'byValue');
  const passes = given.map((argument) =>
    argument.kind === 'value'
      ? argument.register
      : unreachable('A deferred call passes everything by value; the checker refuses references.'),
  );
  const gives = call.kind === 'DeferredCall' ? givenFunction(context, call) : undefined;
  const givenAs = context.body.deferredFunctionOf(site);
  const plan: DeferredPlan = {
    site,
    target: target.kind === 'value' ? { kind: 'captured' } : target,
    passes: passes.length,
    gives: gives && { plan: gives.plan, at: givenAtOf(givenAt) },
    result: context.typeOf(site),
    givenAs:
      givenAs !== undefined && takesNothing(givenAs)
        ? givenAs
        : unreachable('A deferred call checked clean is given as a function taking nothing.'),
  };
  const callee = target.kind === 'value' ? [target.register] : [];
  return { plan, values: [...callee, ...passes, ...(gives?.values ?? [])] };
}

/** What the function `node` gives computes now, and the plan making its call later. */
function givenFunction(context: FunctionContext, node: DeferredCall) {
  const call = deferredOf(node) ?? unreachable('A deferred call of no call checked clean.');
  return computedNow(context, call, node.call);
}

/** A closure of the entry `entry`, capturing `values`, made at `span`. */
function closure(
  context: CodeContext,
  entry: number,
  values: readonly Register[],
  span: AnchoredSpan,
): Register {
  const dst = context.code.allocate();
  context.code.emit({ kind: 'closure', span, dst, function: entry, captures: [...values] });
  return dst;
}

/**
 * The entry of the function a deferred call gives: it makes the call from what it captures and
 * returns what the call gives as the function is given.
 */
export function deferredEntry(
  lowering: Pick<CodeContext, 'checker' | 'tables'>,
  deferred: DeferredFunction,
): CodeFunction {
  const { checker, tables } = lowering;
  const { plan, owner } = deferred;
  const { span } = plan.site;
  const code = new SynthesizedCode(lowering, span, 0, capturedBy(plan));
  const called = madeCall(code, deferred, code.captures);
  const { reach, persistence } = plan.givenAs;
  const from = functionType({ reach, persistence, parameters: [], result: plan.result });
  const module = checker.moduleOf(ownerDeclaration(owner));
  const isAsync = returnedAs(code, called, { from, to: plan.givenAs }, { module, span });
  const mode = codeModeOf(isAsync, builtKindOf(checker, plan.givenAs));
  return code.entry(tables.deferredHeader(deferred), mode);
}

/** How many values a function `plan` makes captures. */
function capturedBy(plan: DeferredPlan): number {
  const callee = plan.target.kind === 'captured' ? 1 : 0;
  return callee + plan.passes + (plan.gives === undefined ? 0 : capturedBy(plan.gives.plan));
}

/**
 * `plan`'s call made from `values`, what its function captured: a function value's callee, then
 * what the call passes, and, for a deferred call, the function it gives, made from the rest and
 * passed where its plan places it.
 */
function madeCall(
  code: SynthesizedCode,
  { owner, plan }: DeferredFunction,
  values: readonly Register[],
): Register {
  const callees = plan.target.kind === 'captured' ? 1 : 0;
  const [callee] = values;
  const target: CallTarget =
    plan.target.kind === 'function'
      ? plan.target
      : { kind: 'value', register: callee ?? unreachable('A function value is captured first.') };
  const passed = values.slice(callees, callees + plan.passes);
  const { gives } = plan;
  const registers =
    gives === undefined
      ? passed
      : passed.toSpliced(
          gives.at,
          0,
          closure(
            code,
            code.tables.deferredIndex({ owner, plan: gives.plan }),
            values.slice(callees + plan.passes),
            gives.plan.site.span,
          ),
        );
  const arguments_ = registers.map((register) => ({ kind: 'value', register }) as const);
  return emitTo(code, plan.site.span, target, arguments_);
}
