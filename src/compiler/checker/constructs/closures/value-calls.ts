/**
 * Calling a function value (§3.14): a variable, a field or any expression of a function type. Its
 * type says everything: there is one function to call, so nothing is chosen, but its arguments are
 * judged, reported and fitted as a chosen function's are (resolution/calls/resolve/index.ts), as
 * one signature with no type parameters, so every argument rule has one home.
 *
 * - Calling an async function value starts it and yields its future, `Future<R>` for an
 *   `async fn(…) -> R`, as calling a declared async function does (§3.3).
 * - Type arguments can't be given: a function value is one instance, never generic. Its parameters
 *   are known before its arguments are checked, so each argument by position is checked against
 *   its parameter's type, as a variant's (`valueParameterTypes`).
 * - Its type names no parameters, so its call gives every argument by position, with no name;
 *   a spread only fills a pack its type ends in (§3.3, §3.5).
 * - An argument still open in the call's constraint scope (wiring/body/constraint-scope.ts) is matched
 *   in it, so `f(id(1))` bounds `id`'s variable by `f`'s parameter; the call then joins the scope,
 *   and is fitted, or reported, once it settles, with every type as it settled.
 */

import type { CallArgument, CallingNode } from '../../../syntax/expressions/calls.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import { calledName } from '../../../syntax/expressions/readings.ts';
import type { BodyContext, ValueCallRecord } from '../../contexts/body-context.ts';
import type { Pass, Passes, PassRecords, PassTable } from '../../contexts/passes.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import {
  filledTypes,
  fitArguments,
  withSolvedTypes,
} from '../../resolution/applying/argument-fit.ts';
import { checkReferencedPlaces } from '../../resolution/calls/places.ts';
import { explain } from '../../resolution/calls/resolve/explanations.ts';
import {
  appliedArgumentOf,
  callArgumentOf,
  type WrittenArgument,
} from '../../resolution/calls/resolve/index.ts';
import { stoppedOperation } from '../../resolution/calls/stopped-operations.ts';
import { type Taken, takenBy } from '../../resolution/choosing/applicability.ts';
import { bindArguments } from '../../resolution/choosing/binding.ts';
import type { Inapplicability, Takes } from '../../resolution/choosing/call-arguments.ts';
import type { Binding, ValueCallMade } from '../../surface/resolved-call.ts';
import type { Inference } from '../../types/inference/infer.ts';
import { noSubstitution } from '../../types/parts/substitution.ts';
import { fieldOf } from '../../types/traits/known-fields.ts';
import { packRestSlot } from '../../types/type/function-types.ts';
import type { FunctionType, Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type/type-text.ts';
import { insideOptional } from '../../types/unions/inside-optional.ts';

/**
 * The type each argument of a call of a value of `callee`'s type is known to take before it is
 * checked: its parameter's, by position. None where only judging the call can say what goes where:
 * `callee` isn't a function type, type arguments are written, the arguments don't match its
 * parameters one to one (a named argument, a spread, too few or too many), or an argument passes
 * by `&` where its parameter doesn't, or the reverse.
 */
export function valueParameterTypes(
  callee: Type | undefined,
  written: readonly CallArgument[],
  typeArguments: readonly Type[] | undefined,
): readonly (Type | undefined)[] {
  if (callee?.kind !== 'function' || typeArguments !== undefined) {
    return [];
  }
  const { parameters } = callee;
  const matches =
    (callee.pack === undefined
      ? written.length === parameters.length
      : written.length >= parameters.length) &&
    written.every(
      (argument, index) =>
        argument.kind !== 'NamedArgument' &&
        argument.kind !== 'Spread' &&
        (argument.kind === 'Reference') === (parameters[index]?.reference ?? false),
    );
  return matches ? parameters.map((parameter) => parameter.type) : [];
}

/**
 * The type of the function value the value call `node` calls, as its call read it: its callee's,
 * or for `x.f(…)`, which reads it from a field of its receiver and checks no expression for it,
 * that field's.
 */
export function calledValueType(context: BodyContext, node: CallingNode): Type {
  const callee = calledName(node);
  const checked = context.checkedTypeOf(callee);
  if (checked !== undefined || callee.kind !== 'MemberAccess') {
    return checked ?? errorType;
  }
  const receiver = context.typeOf(callee.target);
  return fieldOf(context.checker, receiver, callee.member.text)?.member.type ?? errorType;
}

/** The calls of function values in one body, recorded as each is checked. */
export class ValueCalls implements ValueCallRecord {
  readonly #calls: PassTable<CallingNode, ValueCallMade>;

  constructor(passes: Passes) {
    this.#calls = passes.table();
  }

  record(node: CallingNode): void {
    this.#calls.set(node, { binding: undefined });
  }

  bind(node: CallingNode, binding: Binding): void {
    this.#calls.set(node, { binding });
  }

  has(node: CallingNode): boolean {
    return this.#calls.has(node);
  }

  /** The calls as `pass` sees them. */
  at(pass: Pass): PassRecords<CallingNode, ValueCallMade> {
    return this.#calls.at(pass);
  }
}

/** A call as written: where it stands, with its arguments and any type arguments. */
export interface ValueCall {
  readonly node: CallingNode;
  readonly typeArguments: readonly Type[] | undefined;
  readonly written: readonly WrittenArgument[];
}

/** A call of `callee`, whose type, if already checked, is `calleeType`. */
export function checkValueCall(
  context: BodyContext,
  call: ValueCall,
  callee: Expression,
  calleeType: Type = context.expression(callee),
): Type {
  const stopped = stoppedOperation(context, call.node, [{ node: callee, type: calleeType }]);
  if (stopped !== undefined) {
    return stopped;
  }
  context.valueCalls.record(call.node);
  if (calleeType.kind !== 'function') {
    context.report(
      insideOptional(callee.span, calleeType, '(') ??
        checkerDiagnostics.notFunction(callee.span, typeText(calleeType)),
    );
    return errorType;
  }
  const { node, written, typeArguments } = call;
  if (written.some(({ type }) => type?.kind === 'error')) {
    return errorType;
  }
  const unpositional = written.find(
    ({ name, isSpread }) =>
      name !== undefined || (isSpread === true && calleeType.pack === undefined),
  );
  if (unpositional !== undefined) {
    const form = unpositional.isSpread === true ? 'spread' : 'named argument';
    context.report(checkerDiagnostics.valueCallArgument(unpositional.node.span, form));
    return errorType;
  }
  const { parameters, pack } = calleeType;
  const unnamed = { name: undefined, isReceiver: false, hasDefault: false };
  const fixed = parameters.map((slot) => ({ ...slot, ...unnamed, rest: undefined }));
  const packed =
    pack === undefined ? [] : [{ type: pack, reference: false, ...unnamed, rest: packRestSlot }];
  return applyValueCall(context, {
    node,
    name: callee.kind === 'Identifier' ? callee.text : typeText(calleeType),
    written,
    typeArguments,
    takes: { typeParameters: [], parameters: [...fixed, ...packed] },
    callee: calleeType,
    type: calleeType.result,
  });
}

/** A function value's call whose arguments can be judged: what judging and completing it read. */
interface MadeValueCall {
  readonly node: CallingNode;
  /** The callee's name, or its type, as reports name the call. */
  readonly name: string;
  readonly written: readonly WrittenArgument[];
  readonly typeArguments: readonly Type[] | undefined;
  /** Its type as a signature with no type parameters, its pack a rest parameter. */
  readonly takes: Takes;
  readonly callee: FunctionType;
  /** What the call gives. */
  readonly type: Type;
}

/**
 * Judges `call`'s arguments and fits them: at once when none is open in the current scope; else
 * matched in it, the call joining it, fitted or reported once it settles, with every type as it
 * settled.
 */
function applyValueCall(context: BodyContext, call: MadeValueCall): Type {
  const { written } = call;
  const scope = context.scopes.root;
  if (scope === undefined || !written.some(({ type }) => context.scopes.holds(type))) {
    return completeValueCall(context, call, written, takenFor(context, call, written)) ?? errorType;
  }
  const taken = takenFor(context, call, written, scope);
  if ('inference' in taken) {
    context.scopes.commit(taken.inference);
  } else {
    context.scopes.abandon(written.map(({ type }) => type));
  }
  context.scopes.whenSolved((solved) => {
    const settled = withSolvedTypes(written, solved);
    completeValueCall(
      context,
      call,
      settled,
      'inference' in taken ? taken : takenFor(context, call, settled),
    );
  });
  return 'inference' in taken ? call.type : errorType;
}

/** How `call` takes `given`, its candidates' systems copies of `scope`'s, if given. */
function takenFor(
  context: BodyContext,
  call: MadeValueCall,
  given: readonly WrittenArgument[],
  scope?: Inference,
): Taken | Inapplicability {
  return takenBy(context.checker, call.takes, {
    callArguments: given.map(callArgumentOf),
    written: call.typeArguments,
    binder: bindArguments,
    scope,
  });
}

/**
 * Fits `given` to `call`'s parameters as `taken` found them, and checks the places they pass:
 * `call`'s type; undefined after reporting why `taken` refused them.
 */
function completeValueCall(
  context: BodyContext,
  call: MadeValueCall,
  given: readonly WrittenArgument[],
  taken: Taken | Inapplicability,
): Type | undefined {
  const { node, name, typeArguments, callee } = call;
  if (!('inference' in taken)) {
    explain(context, { site: node, name, arguments: given, typeArguments }, taken);
    return undefined;
  }
  const { typeRules } = context.checker;
  fitArguments(
    context,
    given.map(appliedArgumentOf),
    filledTypes(typeRules, taken, noSubstitution, given.length),
  );
  checkReferencedPlaces(context, given, {
    name,
    // A function value is async wherever its call gives a future: its type is all that is known.
    isAsync: context.checker.fitting.futureValue(callee.result) !== undefined,
    slots: given.map((_, index) => taken.slots.get(index) ?? { reference: false }),
  });
  context.valueCalls.bind(node, taken.binding);
  return call.type;
}
