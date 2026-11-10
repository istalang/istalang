/**
 * Calls (§3.3, §3.7, §3.10): the callee names a set of candidates, and the arguments' types choose
 * one (resolution/). A callee is written as:
 *
 * - a function's name, plain or through a namespace (`m.f()`), which looks only in that module,
 *   with no argument-dependent lookup (§3.13);
 * - a type and a static function (`Duration.zero()`, `T.zero()`, `time.Duration.zero()`);
 * - a type alone, a conversion (`Float(3)`), which calls the type's static `from` (§3.10);
 * - a variant with fields, bare or qualified (`Ok(v)`, `Verdict.Rejected(by: "legal")`), which
 *   calls its constructor (structs/variants.ts, §3.11), its one candidate, as any generic call.
 *   A function value's parameters are known before its arguments, so each argument by position
 *   is checked against its parameter's type (closures/value-calls.ts).
 *
 * - a method called on a receiver (`x.f()`): a function whose first parameter is `self`, found by
 *   its name where the call is written and through the receiver's type (argument-dependent
 *   lookup), with the receiver as its first argument (§3.7). Which overload the receiver's type
 *   picks decides whether `self` is a reference, and only then must the receiver be a place that
 *   may change.
 * - a function value: a variable, a field of the receiver, or any other expression of a function
 *   type (constructs/closures/value-calls.ts), or of an optional one, called as `f?.(…)`, a link of
 *   an optional chain (access/optionals.ts). `x.f()` naming both a field and a method of `x`'s type
 *   is ambiguous, so it is reported; `(x.f)()` calls the field.
 * - `worker.disposing()`, a method of the call an async function's own name is before a `.`
 *   (constructs/closures/own-calls.ts).
 *
 * An argument written `&x` passes the place `x` by reference, which must be a place that may change
 * (resolution/calls/places.ts). A named argument fills the parameter of its name, and a spread a
 * rest parameter (§3.3, resolution/choosing/binding.ts). An argument given by position after a
 * named one was reported by the parser, so it counts as the error type: the call still checks its
 * arguments and records the candidates a tool shows while the call is being written, and reports
 * nothing more.
 *
 * A deferred call calls its taker as a call calls its callee, with the function making its call
 * given after the arguments its parentheses write (deferred-calls.ts, §3.14), so every form of
 * callee above may take one, and its call is resolved and recorded at the deferred call.
 */

import { staticName } from '../../../../foundation/language/static-names.ts';
import { conversionFunction } from '../../../../foundation/language/well-known/implicit-calls.ts';
import type { Entity } from '../../../binder/entities.ts';
import { isMethod } from '../../../syntax/declarations/methods.ts';
import { misplacedArgument } from '../../../syntax/expressions/arguments.ts';
import type { Call, CallingNode } from '../../../syntax/expressions/calls.ts';
import type { MemberAccess } from '../../../syntax/expressions/index.ts';
import {
  calledName,
  callsThroughOptional,
  callTypeArguments,
  writtenArgumentsOf,
} from '../../../syntax/expressions/readings.ts';
import { type Identifier, isMissingName } from '../../../syntax/tree/node.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { resolveCall, type WrittenArgument } from '../../resolution/calls/resolve/index.ts';
import { stoppedOperation } from '../../resolution/calls/stopped-operations.ts';
import {
  callableThrough,
  callCandidates,
  staticCandidates,
  staticTargetOf,
  topLevelCandidates,
} from '../../resolution/choosing/candidates.ts';
import { fieldOf } from '../../types/traits/known-fields.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type/type-text.ts';
import { insideOptional } from '../../types/unions/inside-optional.ts';
import { namedType } from '../../types/written/named-types.ts';
import { checkValueCall, valueParameterTypes } from '../closures/value-calls.ts';
import { readsNothing, readsThroughNamespace, recordFieldRead } from './access/member-access.ts';
import { writtenArgument } from './call-arguments.ts';
import { checkVariantCall } from './structs/variants.ts';

/**
 * Checks a call in the current constraint scope (wiring/body/constraint-scope.ts); one continuing an
 * optional chain, whose value the chain carries and wraps (access/optionals.ts), in a scope of its
 * own, once what it is called on is read.
 */
export function checkCall(context: BodyContext, node: Call, expected: Type | undefined): Type {
  const call = { node, expected, value: calledValue(context, node) };
  return context.chains.continues(node)
    ? context.scopes.isolated(() => checkCallMade(context, call))
    : checkCallMade(context, call);
}

/**
 * A call to check: its node, the type expected of it, and what was read of its callee's value; for
 * a deferred call, the function it gives its taker after the arguments written, checked after them.
 */
export interface CallToCheck {
  readonly node: CallingNode;
  readonly expected: Type | undefined;
  readonly value: CalledValue | undefined;
  readonly given?: () => WrittenArgument;
}

/**
 * Checks a call whose callee's value, if it has one, is read: its arguments, then what it calls.
 * One that can't be made gives the error type where its arguments go (`BodyContext.abandon`).
 */
export function checkCallMade(
  context: BodyContext,
  { node, expected, value, given }: CallToCheck,
): Type {
  const written = writtenArgumentsOf(node);
  const misplaced = misplacedArgument(written);
  const typeArguments = callTypeArguments(node)?.map((argument) => context.resolveType(argument));
  const known = valueParameterTypes(value?.type, written, typeArguments);
  const checked = written.map((argument, index) => {
    if (argument === misplaced) {
      return { ...writtenArgument(context, argument, undefined), type: errorType };
    }
    return writtenArgument(context, argument, known[index]);
  });
  const call: WrittenCall = {
    node,
    expected,
    typeArguments,
    written: given === undefined ? checked : [...checked, given()],
  };
  const type = calledBy(context, call, value);
  if (type.kind === 'error') {
    context.scopes.abandon(call.written.map((argument) => argument.type));
  }
  return type;
}

/** What `call` calls, by what its callee is, given what was read of its value. */
function calledBy(context: BodyContext, call: WrittenCall, value: CalledValue | undefined): Type {
  const { node } = call;
  const callee = calledName(node);
  if (callsThroughOptional(node)) {
    return checkValueCall(context, call, callee, value?.type ?? errorType);
  }
  if (value !== undefined && value.receiver === undefined) {
    return checkValueCall(context, call, callee, value.type ?? errorType);
  }
  switch (callee.kind) {
    case 'Identifier':
      return callEntity(context, call, callee, context.entityOf(callee));
    case 'MemberAccess': {
      const nothing = readsNothing(context, call.node, callee);
      if (nothing !== undefined) {
        return nothing;
      }
      const entity = context.entityOf(callee.member);
      if (entity !== undefined) {
        return callEntity(context, call, callee, entity);
      }
      const owner = namedType(context, callee.target);
      return owner === undefined
        ? callMethod(context, call, callee, value?.receiver)
        : callStatic(context, call, owner, callee.member.text);
    }
    default:
      return checkValueCall(context, call, callee);
  }
}

/**
 * What a call calls, when its type is known before its arguments: a variable, an expression other
 * than a name, or an optional call's target (§3.14), and a receiver's field (`receiverField`),
 * which a method of the same name makes an error the call reports.
 */
export function calledValue(context: BodyContext, node: CallingNode): CalledValue | undefined {
  if (callsThroughOptional(node)) {
    return { type: context.chains.target(context, node) };
  }
  const callee = calledName(node);
  switch (callee.kind) {
    case 'Identifier':
      return context.entityOf(callee)?.kind === 'variable'
        ? { type: context.expression(callee) }
        : undefined;
    case 'MemberAccess':
      return receiverField(context, node, callee);
    default:
      return { type: context.settled(callee) };
  }
}

/**
 * What `x.f(…)` reads of its receiver before its arguments: the receiver's type, read once here
 * for the call, and the type of the field `f` names, if any. Undefined where the callee names no
 * receiver's member: a missing name, a namespace's member, a type's static function.
 */
function receiverField(
  context: BodyContext,
  node: CallingNode,
  callee: MemberAccess,
): CalledValue | undefined {
  if (
    isMissingName(callee.member) ||
    readsThroughNamespace(context, callee) ||
    context.entityOf(callee.member) !== undefined ||
    namedType(context, callee.target) !== undefined
  ) {
    return undefined;
  }
  const receiver = context.chains.target(context, node);
  return { type: fieldOf(context.checker, receiver, callee.member.text)?.member.type, receiver };
}

/**
 * The type of what a call calls, when it is known before its arguments, and for `x.f(…)` the
 * receiver's type, read then.
 */
export interface CalledValue {
  readonly type: Type | undefined;
  readonly receiver?: Type;
}

/**
 * `x.f(…)`: `f` called with `x` as its `self` (§3.7); also as a link of an optional chain, which
 * calls it on the value inside and never through `&self` (access/optionals.ts).
 */
function callMethod(
  context: BodyContext,
  call: WrittenCall,
  callee: MemberAccess,
  read: Type | undefined,
): Type {
  const { checker, chains } = context;
  const receiver = callee.target;
  const receiverType = read ?? chains.target(context, call.node);
  const stopped = stoppedOperation(context, call.node, [{ node: receiver, type: receiverType }]);
  if (stopped !== undefined) {
    return stopped;
  }
  const name = callee.member.text;
  const field = fieldOf(checker, receiverType, name);
  const written = [
    { node: receiver, passing: 'receiver', type: receiverType } as const,
    ...call.written,
  ];
  const types = written.map(({ type }) => type);
  const methods = topLevelCandidates(checker, context.module, name, types).filter(
    ({ declaration }) => isMethod(declaration),
  );
  if (field !== undefined && methods.length > 0) {
    context.report(
      checkerDiagnostics.fieldOrMethod(callee.member.span, typeText(receiverType), name),
    );
    return errorType;
  }
  if (field !== undefined) {
    recordFieldRead(context, callee, field);
    return checkValueCall(context, call, callee, field.member.type);
  }
  const candidates = callableThrough(checker, callee, methods);
  if (candidates.length === 0) {
    context.report(
      methods.length > 0
        ? checkerDiagnostics.receiverNotPlace(receiver.span, name)
        : checkerDiagnostics.noMember(callee.member.span, typeText(receiverType), name),
    );
    return errorType;
  }
  return resolveCall(context, {
    site: call.node,
    recorded: call.node,
    name,
    candidates,
    arguments: written,
    typeArguments: call.typeArguments,
    expected: call.expected,
    form: 'call',
    receiver,
    hint: () => insideOptional(receiver.span, receiverType, '.'),
  });
}

/** A call with plain arguments, each checked unless the chosen function decides its type. */
interface WrittenCall {
  readonly node: CallingNode;
  readonly expected: Type | undefined;
  readonly typeArguments: readonly Type[] | undefined;
  readonly written: readonly WrittenArgument[];
}

function callEntity(
  context: BodyContext,
  call: WrittenCall,
  callee: Identifier | MemberAccess,
  entity: Entity | undefined,
): Type {
  const name = callee.kind === 'Identifier' ? callee.text : callee.member.text;
  switch (entity?.kind) {
    case 'functions': {
      const { checker } = context;
      const named = checker.bindings.overloadsOf(entity);
      const types = call.written.map(({ type }) => type);
      const throughNamespace = callee.kind === 'MemberAccess';
      const candidates = throughNamespace
        ? named.map((declaration) => ({ declaration }))
        : callCandidates(checker, named, name, types);
      return resolve(context, call, name, candidates);
    }
    case undefined:
      return errorType;
    case 'variable':
      return checkValueCall(context, call, callee);
    case 'variant':
    case 'variants':
      return checkVariantCall(context, call, callee, entity);
    case 'type':
    case 'primitive': {
      const owner = namedType(context, callee);
      return owner === undefined ? errorType : callStatic(context, call, owner, conversionFunction);
    }
    default:
      context.report(checkerDiagnostics.notCallable(callee.span, name));
      return errorType;
  }
}

/** A static call of `name` through the type `owner` (§3.7), a conversion being one (§3.10). */
function callStatic(context: BodyContext, call: WrittenCall, owner: Type, name: string): Type {
  const { checker, module } = context;
  const target = staticTargetOf(checker, owner);
  const candidates = target === undefined ? [] : staticCandidates(checker, module, target, name);
  if (candidates.length === 0) {
    if (owner.kind !== 'error') {
      context.report(checkerDiagnostics.noStaticFunction(call.node.span, typeText(owner), name));
    }
    return errorType;
  }
  return resolve(context, call, staticName(typeText(owner), name), candidates);
}

function resolve(
  context: BodyContext,
  call: WrittenCall,
  name: string,
  candidates: Parameters<typeof resolveCall>[1]['candidates'],
): Type {
  return resolveCall(context, {
    site: call.node,
    recorded: call.node,
    name,
    candidates,
    arguments: call.written,
    typeArguments: call.typeArguments,
    expected: call.expected,
    form: 'call',
  });
}
